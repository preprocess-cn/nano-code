import { LLMClient, ChatMessage } from './llm.js';
import { PluginRegistry, ToolCall } from './plugin.js';
import { SystemPromptConfig } from './config.js';
import { buildSystemPrompt, formatToolResponse } from './prompt.js';
import { DisplayManager } from './display.js';
import { ToolResponse, InjectedMessage, isMainAgent } from './contract.js';

export class NanoCodeAgent {
  private llmClient: LLMClient;
  private messageHistory: ChatMessage[] = [];
  private registry: PluginRegistry;
  private agentRole?: string;
  private promptConfig?: SystemPromptConfig;
  private name: string;
  private display?: DisplayManager;

  constructor(registry: PluginRegistry, llmClient?: LLMClient, agentRole?: string, promptConfig?: SystemPromptConfig, name = 'main', display?: DisplayManager) {
    this.llmClient = llmClient || new LLMClient();
    this.registry = registry;
    this.agentRole = agentRole;
    this.promptConfig = promptConfig;
    this.name = name;
    this.display = display;
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

  async runTask(userPrompt: string): Promise<string | undefined> {
    this.display?.onAgentTurnStart({ agentName: this.name });

    // 检查插件是否已执行自动压缩（如 token-budget），加载结果
    const compacted = this.registry.store.get<ChatMessage[]>('compact:result');
    if (compacted) {
      this.loadHistory(compacted);
      this.registry.store.set('compact:result', undefined);
    }

    this.messageHistory.push({
      role: 'user',
      content: userPrompt,
    });

    this.registry.store.set('agent', { agentName: this.name, status: 'running', messageCount: this.messageHistory.length });

    while (true) {
      if (this.registry.store.get<boolean>('agent:cancelled')) {
        this.display?.onStatus({ message: 'end', agentName: this.name });
        this.registry.store.set('agent:cancelled', undefined);
        break;
      }
      this.display?.onStatus({ message: 'thinking', agentName: this.name });

      const systemMessage = buildSystemPrompt(this.registry, this.promptConfig, this.agentRole);
      let messagesWithSystem: ChatMessage[] = [systemMessage, ...this.messageHistory];
      messagesWithSystem = this.registry.execBeforeRequest(messagesWithSystem);

      const isSubAgent = !isMainAgent(this.name);
      let streamBuffer = '';

      const onChunk = (chunk: string) => {
        if (!chunk) return;
        if (isSubAgent) streamBuffer += chunk;
        else this.display?.onStreamChunk({ text: chunk, agentName: this.name });
      };

      const extraParams = this.registry.collectExtraParams();
      let responseMeta: Record<string, unknown> | undefined;

      // Set up cancellation: AbortController for LLM stream, flag for checkpoints
      const abortController = new AbortController();
      this.registry.store.set('agent:abort', abortController);
      const isCancelled = () => this.registry.store.get<boolean>('agent:cancelled') === true;

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
          this.registry.store.set('agent:abort', undefined);
          this.display?.onStatus({ message: 'end', agentName: this.name });
          this.display?.onAgentTurnEnd({ agentName: this.name });
          break;
        }
        throw err;
      }

      this.registry.store.set('agent:abort', undefined);

      if (isCancelled()) {
        this.display?.onStatus({ message: 'end', agentName: this.name });
        this.display?.onAgentTurnEnd({ agentName: this.name });
        break;
      }

      this.registry.execAfterRequest(response, responseMeta);

      if (isSubAgent && streamBuffer) {
        this.display?.onStreamChunk({ text: '\n' + streamBuffer + '\n', agentName: this.name });
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
        this.display?.onStatus({ message: 'end', agentName: this.name });
        this.display?.onStateSnapshot({ agentName: this.name, messageCount: this.messageHistory.length });
        this.display?.onAgentTurnEnd({ agentName: this.name });
        break;
      }

      for (const rawToolCall of response.toolCalls) {
        if (isCancelled()) break;
        const tcResult = await this.executeToolCall(rawToolCall);
        for (const msg of tcResult.toolMessages) this.messageHistory.push(msg);
        if (tcResult.status === 'rejected') break;
      }

      this.display?.onStateSnapshot({ agentName: this.name, messageCount: this.messageHistory.length });
		this.registry.store.set("agent", { agentName: this.name, status: "running", messageCount: this.messageHistory.length });
    }

    this.registry.store.set('agent', { agentName: this.name, status: 'idle', messageCount: this.messageHistory.length });
    this.registry.store.set('agent:messages', this.getHistory());

    const lastMsg = this.messageHistory[this.messageHistory.length - 1];
    if (lastMsg?.role === 'assistant') {
      return lastMsg.content || undefined;
    }
    return undefined;
  }

  private async executeToolCall(rawToolCall: any): Promise<{ status: 'rejected' | 'ok'; toolMessages: ChatMessage[] }> {
    const toolName = rawToolCall.function.name;
    const toolMessages: ChatMessage[] = [];

    let toolArgs: any;
    try {
      toolArgs = JSON.parse(rawToolCall.function.arguments);
    } catch {
      toolMessages.push({
        role: 'tool', tool_call_id: rawToolCall.id, name: toolName,
        content: JSON.stringify({ status: 'error', message: `工具调用 "${toolName}" 的参数不是合法的 JSON 格式：${rawToolCall.function.arguments}。请修正参数格式后重试。` }),
      });
      return { status: 'ok', toolMessages };
    }

    const toolCall: ToolCall = {
      id: rawToolCall.id,
      function: { name: toolName, arguments: rawToolCall.function.arguments },
    };

    const allowedCall = this.registry.execBeforeToolCall(toolCall);
    if (allowedCall === null) {
      this.display?.onStatus({ message: `tool_blocked:${toolName}`, agentName: this.name });
      toolMessages.push({
        role: 'tool', tool_call_id: toolCall.id, name: toolName,
        content: JSON.stringify({ status: 'error', message: 'Tool call blocked by plugin policy.' }),
      });
      return { status: 'ok', toolMessages };
    }

    this.display?.onToolCall({ toolName, args: toolArgs, agentName: this.name });

    let toolResult: ToolResponse;
    try {
      toolResult = await this.registry.execute(toolName, toolArgs);
    } catch (err: any) {
      toolResult = { status: 'error', message: `工具物理执行失败: ${err.message}` };
    }
    this.registry.execAfterToolCall(toolResult);

    // Inline skill 展开：newMessages 以 user 消息形式在 tool_result 之前注入
    if (toolResult.newMessages) {
      for (const msg of toolResult.newMessages) {
        toolMessages.push({ role: 'user', content: msg.content });
      }
    }

    this.display?.onToolResult({ status: toolResult.status, message: toolResult.message, agentName: this.name });

    toolMessages.push({
      role: 'tool', tool_call_id: rawToolCall.id, name: toolName,
      content: formatToolResponse(toolResult),
    });

    const status = toolResult.status === 'rejected_by_user' ? 'rejected' : 'ok';
    return { status, toolMessages };
  }
}
