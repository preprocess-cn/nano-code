import { LLMClient, ChatMessage } from '#src/core/llm.js';
import { PluginRegistry } from '#src/core/plugin.js';
import { SystemPromptConfig } from '#src/core/config.js';
import { buildSystemPrompt, formatToolResponse } from '#src/core/prompt.js';
import { ToolResponse, ToolContext, ToolCall, InjectedMessage, isMainAgent, AgentDisplay } from '#src/core/contract.js';
import { getToolDisplayName } from '#src/core/tool-name.js';
import { SK, agentStatusKey, agentAbortKey, agentMessagesKey, agentCancelledKey, compactResultKey } from '#src/core/store-keys.js';

export interface NanoCodeAgentOptions {
  registry: PluginRegistry;
  llmClient?: LLMClient;
  agentRole?: string;
  promptConfig?: SystemPromptConfig;
  name?: string;
  display?: AgentDisplay;
  /** 外部注入的 AbortController。子 agent 通过此控制器接收父 agent 的取消信号。 */
  abortController?: AbortController;
}

export class NanoCodeAgent {
  private llmClient: LLMClient;
  private messageHistory: ChatMessage[] = [];
  private registry: PluginRegistry;
  private agentRole?: string;
  private promptConfig?: SystemPromptConfig;
  private name: string;
  private display?: AgentDisplay;
  private abortController?: AbortController;

  constructor(options: NanoCodeAgentOptions) {
    this.llmClient = options.llmClient || new LLMClient();
    this.registry = options.registry;
    this.agentRole = options.agentRole;
    this.promptConfig = options.promptConfig;
    this.name = options.name ?? 'main';
    this.display = options.display;
    this.abortController = options.abortController;
  }

  getName(): string {
    return this.name;
  }

  /** 暴露 LLMClient 供 CompactService 等使用 */
  getLLMClient(): LLMClient {
    return this.llmClient;
  }

  getHistory(): ChatMessage[] {
    return [...this.messageHistory];
  }

  loadHistory(messages: ChatMessage[]): void {
    this.messageHistory = [...messages];
  }

  /** 运行时切换 agent 角色 */
  setRole(role?: string, promptConfig?: SystemPromptConfig): void {
    this.agentRole = role;
    this.promptConfig = promptConfig;
  }

  getAgentRole(): string | undefined {
    return this.agentRole;
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.messageHistory = [];
  }

  /** 注入消息到历史末尾（默认 user 角色，/context 用 assistant） */
  injectMessages(msgs: InjectedMessage[]): void {
    for (const msg of msgs) {
      this.messageHistory.push({ role: msg.role || 'user', content: msg.content });
    }
  }

  /** 通知 display 层当前 turn 已结束 */
  private endTurn(): void {
    this.display?.onStatus?.({ message: 'end', agentName: this.name, level: 'status' });
    this.display?.onAgentTurnEnd?.({ agentName: this.name });
  }

  async runTask(userPrompt: string): Promise<string | undefined> {
    this.display?.onAgentTurnStart?.({ agentName: this.name });

    // 检查插件是否已执行自动压缩（如 token-budget），加载结果
    const compacted = this.registry.store.get<ChatMessage[]>(compactResultKey(this.name));
    if (compacted) {
      this.loadHistory(compacted);
      this.registry.store.set(compactResultKey(this.name), undefined);
    }

    this.messageHistory.push({
      role: 'user',
      content: userPrompt,
    });

    this.registry.store.set(agentStatusKey(this.name), { agentName: this.name, status: 'running', messageCount: this.messageHistory.length });

    try {
      while (true) {
        if (this.registry.store.get(agentCancelledKey(this.name))) {
          this.endTurn();
          this.registry.store.set(agentCancelledKey(this.name), undefined);
          break;
        }
      this.display?.onStatus?.({ message: 'thinking', agentName: this.name, level: 'status' });

      const systemMessage = buildSystemPrompt(this.registry, this.promptConfig, this.agentRole);
      let messagesWithSystem: ChatMessage[] = [systemMessage, ...this.messageHistory];

      messagesWithSystem = this.registry.execBeforeRequest(messagesWithSystem);

      const isSubAgent = !isMainAgent(this.name);
      let streamBuffer = '';

      const onChunk = (chunk: string) => {
        if (!chunk) return;
        if (isSubAgent) streamBuffer += chunk;
        else this.display?.onStreamChunk?.({ text: chunk, agentName: this.name });
      };

      const extraParams = this.registry.collectExtraParams();
      let responseMeta: Record<string, unknown> | undefined;

      // Set up cancellation: AbortController for LLM stream, flag for checkpoints
      const abortController = this.abortController ?? new AbortController();
      this.registry.store.set(agentAbortKey(this.name), abortController);
      const isCancelled = () => this.registry.store.get(agentCancelledKey(this.name)) === true || abortController.signal.aborted;

      let response;
      try {
        response = await this.llmClient.sendSystemMessage(
          messagesWithSystem,
          this.registry.getAllSchemas(),
          onChunk,
          extraParams,
          (meta) => { responseMeta = meta; },
          abortController.signal,
        );
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.message === 'CANCELLED' || isCancelled()) {
          this.registry.store.set(agentAbortKey(this.name), undefined);
          this.endTurn();
          break;
        }
        throw err;
      }

      this.registry.store.set(agentAbortKey(this.name), undefined);

      if (isCancelled()) {
        this.endTurn();
        break;
      }

      this.registry.execAfterRequest(response, responseMeta);

      if (isSubAgent && streamBuffer) {
        this.display?.onStreamChunk?.({ text: '\n' + streamBuffer + '\n', agentName: this.name });
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.text || null,
      };

      if (response.toolCalls) {
        assistantMessage.tool_calls = response.toolCalls;
      }
      this.messageHistory.push(assistantMessage);

      if (response.stopReason !== 'tool_use' || !response.toolCalls) {
        this.display?.onStateSnapshot?.({ agentName: this.name, messageCount: this.messageHistory.length });
        this.endTurn();
        break;
      }

      // Partition: read-only tools (no side effect) can run in parallel.
      // Write tools must stay serial to maintain order and permission flow.
      const readOnlyCalls = response.toolCalls.filter(
        tc => !this.registry.getToolSideEffect(tc.function.name)
      );
      const writeCalls = response.toolCalls.filter(
        tc => this.registry.getToolSideEffect(tc.function.name)
      );

      if (readOnlyCalls.length > 0) {
        const results = await Promise.all(
          readOnlyCalls.map(tc => this.executeToolCall(tc))
        );
        for (const r of results) {
          for (const msg of r.toolMessages) this.messageHistory.push(msg);
        }
      }

      for (const rawToolCall of writeCalls) {
        if (isCancelled()) break;
        const tcResult = await this.executeToolCall(rawToolCall);
        for (const msg of tcResult.toolMessages) this.messageHistory.push(msg);
        if (tcResult.status === 'rejected') break;
      }

      // 更新存储中的消息快照，供 token-budget 等插件在下轮循环中做准确的大小判断
      this.registry.store.set(agentMessagesKey(this.name), this.getHistory());

      this.display?.onStateSnapshot?.({ agentName: this.name, messageCount: this.messageHistory.length });
      this.registry.store.set(agentStatusKey(this.name), { agentName: this.name, status: "running", messageCount: this.messageHistory.length });
    }
    } finally {
      // 子 agent 退出时通知插件清理资源，主 agent 不在此处触发（跨轮存活）
      if (!isMainAgent(this.name)) {
        await this.registry.execOnAgentExit(this.name);
      }
    }

    this.registry.store.set(agentStatusKey(this.name), { agentName: this.name, status: 'idle', messageCount: this.messageHistory.length });
    this.registry.store.set(agentMessagesKey(this.name), this.getHistory());

    const lastMsg = this.messageHistory[this.messageHistory.length - 1];
    if (lastMsg?.role === 'assistant') {
      return lastMsg.content || undefined;
    }
    return undefined;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<{ status: 'rejected' | 'ok'; toolMessages: ChatMessage[] }> {
    const toolName = toolCall.function.name;
    const toolMessages: ChatMessage[] = [];

    let toolArgs: any;
    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      toolMessages.push({
        role: 'tool', tool_call_id: toolCall.id, name: toolName,
        content: JSON.stringify({ status: 'error', message: `工具调用 "${toolName}" 的参数不是合法的 JSON 格式：${toolCall.function.arguments}。请修正参数格式后重试。` }),
      });
      return { status: 'ok', toolMessages };
    }

    const allowedCall = this.registry.execBeforeToolCall(toolCall);
    if (allowedCall === null) {
      this.display?.onStatus?.({ message: `工具调用已被插件策略拦截: ${toolName}`, agentName: this.name, level: 'warn' });
      toolMessages.push({
        role: 'tool', tool_call_id: toolCall.id, name: toolName,
        content: JSON.stringify({ status: 'error', message: 'Tool call blocked by plugin policy.' }),
      });
      return { status: 'ok', toolMessages };
    }

    // ── 先展示工具调用信息，再检查权限 ──
    // 顺序：onToolCall → permission gate → execute
    // 用户拒绝时也会显示被拒绝的工具调用及结果
    this.display?.onToolCall?.({ id: toolCall.id, toolName, args: toolArgs, agentName: this.name });

    // ── Permission gate ──
    // sideEffect=true 且不在 allowlist 中的工具需要用户确认
    // 已在 allowlist 中的工具同时跳过工具层权限确认
    let agentConfirmed = false;
    const sideEffect = this.registry.getToolSideEffect(toolName);
    if (sideEffect) {
      if (this.registry.isSkipPermissionScope()) {
        agentConfirmed = true;
      } else if (!this.registry.isToolAllowed(toolName)) {
        const confirmCb = this.registry.getConfirmCallback();
        if (confirmCb) {
          const displayName = getToolDisplayName(toolName, this.registry.getAllSchemas());
          const response = await confirmCb({
            toolName,
            displayName,
            message: `${displayName} 需要执行操作，是否批准？`,
            details: JSON.stringify(toolArgs, null, 2).slice(0, 1000),
          });
          if (response === 'always_allow') {
            this.registry.allowTool(toolName);
            agentConfirmed = true;
          } else if (response) {
            agentConfirmed = true;
          } else {
            this.display?.onToolResult?.({ id: toolCall.id, status: 'rejected_by_user', message: '用户拒绝', agentName: this.name });
            toolMessages.push({
              role: 'tool', tool_call_id: toolCall.id, name: toolName,
              content: JSON.stringify({ status: 'rejected_by_user', message: '用户拒绝工具调用' }),
            });
            return { status: 'rejected', toolMessages };
          }
        }
      } else {
        // 工具已在 allowlist 中 — 跳过工具层的二次权限确认
        agentConfirmed = true;
      }
    }

    let toolResult: ToolResponse;
    try {
      const execCtx: Partial<ToolContext> = {};
      if (agentConfirmed) execCtx.skipPermission = true;
      toolResult = await this.registry.execute(toolName, toolArgs, execCtx);
    } catch (err: any) {
      toolResult = { status: 'error', message: `工具 "${toolName}" 执行失败：${err.message}` };
    }
    this.registry.execAfterToolCall(toolResult);

    // Inline skill 展开：newMessages 以 user 消息形式在 tool_result 之前注入
    if (toolResult.newMessages) {
      for (const msg of toolResult.newMessages) {
        toolMessages.push({ role: 'user', content: msg.content });
      }
    }

    this.display?.onToolResult?.({ id: toolCall.id, status: toolResult.status, message: toolResult.message, agentName: this.name });

    toolMessages.push({
      role: 'tool', tool_call_id: toolCall.id, name: toolName,
      content: formatToolResponse(toolResult),
    });

    const status = toolResult.status === 'rejected_by_user' ? 'rejected' : 'ok';
    return { status, toolMessages };
  }
}
