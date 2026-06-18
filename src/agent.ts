import { LLMClient, ChatMessage } from './llm.js';
import { PluginRegistry, ToolCall } from './plugin.js';
import { SystemPromptConfig } from './config.js';
import { buildSystemPrompt } from './prompt.js';
import { ThinkStream } from './think-stream.js';
import { DisplayManager } from './display.js';

export class NanoCodeAgent {
  private llmClient: LLMClient;
  private messageHistory: ChatMessage[] = [];
  private registry: PluginRegistry;
  private isDebug = false;
  private showThink = false;
  private agentRole?: string;
  private promptConfig?: SystemPromptConfig;
  private name: string;
  private display?: DisplayManager;

  constructor(registry: PluginRegistry, isDebug = false, showThink = false, llmClient?: LLMClient, agentRole?: string, promptConfig?: SystemPromptConfig, name = 'main', display?: DisplayManager) {
    this.llmClient = llmClient || new LLMClient();
    this.registry = registry;
    this.isDebug = isDebug;
    this.showThink = showThink;
    this.agentRole = agentRole;
    this.promptConfig = promptConfig;
    this.name = name;
    this.display = display;
  }

  getName(): string {
    return this.name;
  }

  getHistory(): ChatMessage[] {
    return [...this.messageHistory];
  }

  loadHistory(messages: ChatMessage[]): void {
    this.messageHistory = [...messages];
  }

  async runTask(userPrompt: string): Promise<string | undefined> {
    this.messageHistory.push({
      role: 'user',
      content: userPrompt,
    });

    while (true) {
      if (this.isDebug) {
        this.display?.onStatus({ message: '\n==================================================', agentName: this.name });
        this.display?.onStatus({ message: '>> [DEBUG] 发送给大模型的完整 Messages 历史:', agentName: this.name });
        this.display?.onDebug({ data: JSON.stringify(this.messageHistory, null, 2), agentName: this.name });
        this.display?.onStatus({ message: '==================================================\n', agentName: this.name });
      }

      this.display?.onStatus({ message: '? 正在思考并请求大模型...', agentName: this.name });

      const thinkStream = new ThinkStream();
      const systemMessage = buildSystemPrompt(this.registry, this.promptConfig, this.agentRole);
      let messagesWithSystem: ChatMessage[] = [systemMessage, ...this.messageHistory];
      messagesWithSystem = this.registry.execBeforeRequest(messagesWithSystem);

      const isSubAgent = this.name !== 'main';
      let streamBuffer = '';

      const onChunk = (chunk: string) => {
        if (!chunk) return;
        const text = this.showThink ? chunk : thinkStream.next(chunk) || '';
        if (!text) return;
        if (isSubAgent) streamBuffer += text;
        else this.display?.onStreamChunk({ text, agentName: this.name });
      };

      const response = await this.llmClient.sendSystemMessage(
        messagesWithSystem,
        this.registry.getAllSchemas(),
        onChunk,
      );

      this.registry.execAfterRequest(response);

      if (this.isDebug) {
        this.display?.onStatus({ message: '\n\n==================================================', agentName: this.name });
        this.display?.onStatus({ message: '[IN] [DEBUG] 大模型返回的原始 Response 响应:', agentName: this.name });
        this.display?.onDebug({ data: JSON.stringify(response, null, 2), agentName: this.name });
        this.display?.onStatus({ message: '==================================================\n', agentName: this.name });
      }

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
        this.display?.onStatus({ message: '\n', agentName: this.name });
        break;
      }

      for (const rawToolCall of response.toolCalls) {
        if (await this.executeToolCall(rawToolCall) === 'rejected') break;
      }
    }

    const lastMsg = this.messageHistory[this.messageHistory.length - 1];
    if (lastMsg?.role === 'assistant') {
      return lastMsg.content || undefined;
    }
    return undefined;
  }

  private async executeToolCall(rawToolCall: any): Promise<'rejected' | 'ok'> {
    const toolName = rawToolCall.function.name;
    let toolArgs: any;
    try {
      toolArgs = JSON.parse(rawToolCall.function.arguments);
    } catch {
      const msg = `工具调用 "${toolName}" 的参数不是合法的 JSON 格式：${rawToolCall.function.arguments}。请修正参数格式后重试。`;
      this.messageHistory.push({
        role: 'tool',
        tool_call_id: rawToolCall.id,
        name: toolName,
        content: JSON.stringify({ status: 'error', message: msg }),
      });
      return 'ok';
    }

    const toolCall: ToolCall = {
      id: rawToolCall.id,
      function: { name: toolName, arguments: rawToolCall.function.arguments },
    };

    const allowedCall = this.registry.execBeforeToolCall(toolCall);
    if (allowedCall === null) {
      this.display?.onStatus({ message: `[!] [拦截] 插件拒绝了工具调用: [ ${toolName} ]`, agentName: this.name });
      this.messageHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify({ status: 'error', message: 'Tool call blocked by plugin policy.' }),
      });
      return 'ok';
    }

    this.display?.onToolCall({ toolName, args: toolArgs, agentName: this.name });
    if (this.isDebug) {
      this.display?.onDebug({ data: `// [DEBUG] 工具入参: ${JSON.stringify(toolArgs)}`, agentName: this.name });
    }

    let resultText = '';
    try {
      resultText = await this.registry.execute(toolName, toolArgs);
    } catch (err: any) {
      resultText = `工具物理执行失败: ${err.message}`;
      if (this.isDebug) {
        this.display?.onDebug({ data: `X [DEBUG] 工具执行崩溃: ${err.stack}`, agentName: this.name });
      }
    }

    let toolResult: any;
    try {
      toolResult = JSON.parse(resultText);
    } catch {
      toolResult = { status: 'error', data: resultText };
    }
    this.registry.execAfterToolCall(toolResult);

    this.display?.onToolResult({ status: toolResult.status, message: toolResult.message, agentName: this.name });

    if (this.isDebug) {
      this.display?.onDebug({ data: `[IN] [DEBUG] 工具返回结果喂给 AI: ${resultText}`, agentName: this.name });
    }

    this.messageHistory.push({
      role: 'tool',
      tool_call_id: rawToolCall.id,
      name: toolName,
      content: resultText,
    });

    return toolResult.status === 'rejected_by_user' ? 'rejected' : 'ok';
  }
}
