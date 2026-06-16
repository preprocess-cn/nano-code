import { LLMClient, ChatMessage } from './llm.js';
import { PluginRegistry, ToolCall } from './plugin.js';
import { buildSystemPrompt } from './prompt.js';

export class NanoCodeAgent {
  private llmClient: LLMClient;
  private messageHistory: ChatMessage[] = [];
  private registry: PluginRegistry;
  private IS_DEBUG = false;
  private SHOW_THINK = false;
  private agentRole?: string;

  constructor(registry: PluginRegistry, isDebug = false, showThink = false, llmClient?: LLMClient, agentRole?: string) {
    this.llmClient = llmClient || new LLMClient();
    this.registry = registry;
    this.IS_DEBUG = isDebug;
    this.SHOW_THINK = showThink;
    this.agentRole = agentRole;
  }

  /** Return a copy of the current message history. */
  getHistory(): ChatMessage[] {
    return [...this.messageHistory];
  }

  /** Replace the message history (e.g. restored from a saved session). */
  loadHistory(messages: ChatMessage[]): void {
    this.messageHistory = [...messages];
  }

  async runTask(userPrompt: string) {
    this.messageHistory.push({
      role: 'user',
      content: userPrompt
    });

    while (true) {
      if (this.IS_DEBUG) {
        console.log('\n==================================================');
        console.log('>> [DEBUG] 发送给大模型的完整 Messages 历史:');
        console.dir(this.messageHistory, { depth: null, colors: true });
        console.log('==================================================\n');
      }

      console.log('? nano-code 正在思考并请求大模型...');

      let isInsideThink = false;
      let streamBuffer = '';

      const systemMessage = buildSystemPrompt(this.registry, this.agentRole);
      let messagesWithSystem: ChatMessage[] = [systemMessage, ...this.messageHistory];

      // Hook: allow plugins to modify messages before sending
      messagesWithSystem = this.registry.execBeforeRequest(messagesWithSystem);

      const response = await this.llmClient.sendSystemMessage(
        messagesWithSystem,
        this.registry.getAllSchemas(),
        (chunk) => {
          if (chunk) {
            if (this.SHOW_THINK) {
              process.stdout.write(chunk);
              return;
            }

            streamBuffer += chunk;

            // 检测是否进入思考区
            if (streamBuffer.includes('<think>')) {
              // 先输出 think 标签前的文本（如果有）
              const beforeThink = streamBuffer.split('<think>')[0];
              if (beforeThink) {
                process.stdout.write(beforeThink);
              }
              isInsideThink = true;
              streamBuffer = streamBuffer.split('<think>')[1] || '';
            }

            // 检测是否离开思考区
            if (streamBuffer.includes('</think>')) {
              isInsideThink = false;
              streamBuffer = streamBuffer.split('</think>')[1] || '';
            }

            if (!isInsideThink && streamBuffer) {
              process.stdout.write(streamBuffer);
              streamBuffer = '';
            }
          }
        }
      );

      // Hook: notify plugins of the LLM response
      this.registry.execAfterRequest(response);

      if (this.IS_DEBUG) {
        console.log('\n\n==================================================');
        console.log('[IN] [DEBUG] 大模型返回的原始 Response 响应:');
        console.dir(response, { depth: null, colors: true });
        console.log('==================================================\n');
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
        console.log('\n');
        break;
      }

      let isCommandRejected = false;

      for (const rawToolCall of response.toolCalls) {
        const toolName = rawToolCall.function.name;
        let toolArgs: any;
        try {
          toolArgs = JSON.parse(rawToolCall.function.arguments);
        } catch (e) {
          const msg = `工具调用 "${toolName}" 的参数不是合法的 JSON 格式：${rawToolCall.function.arguments}。请修正参数格式后重试。`;
          this.messageHistory.push({
            role: 'tool',
            tool_call_id: rawToolCall.id,
            name: toolName,
            content: JSON.stringify({ status: 'error', message: msg }),
          });
          continue;
        }

        // Hook: allow plugins to intercept/modify/deny the tool call
        const toolCall: ToolCall = {
          id: rawToolCall.id,
          function: { name: toolName, arguments: rawToolCall.function.arguments },
        };
        const allowedCall = this.registry.execBeforeToolCall(toolCall);
        if (allowedCall === null) {
          console.log(`\n[!] [拦截] 插件拒绝了工具调用: [ ${toolName} ]`);
          this.messageHistory.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ status: 'error', message: 'Tool call blocked by plugin policy.' }),
          });
          continue;
        }

        console.log(`\n#  AI 申请调用本地工具: [ ${toolName} ]`);
        if (this.IS_DEBUG) {
          console.log(`// [DEBUG] 工具入参:`, toolArgs);
        }

        let resultText = '';
        try {
          resultText = await this.registry.execute(toolName, toolArgs);
        } catch (err: any) {
          resultText = `工具物理执行失败: ${err.message}`;
          if (this.IS_DEBUG) {
            console.error(`X [DEBUG] 工具执行崩溃，完整错误调用栈:`);
            console.error(err.stack);
          }
        }

        // Hook: allow plugins to observe/modify tool result
        let toolResult: any;
        try {
          toolResult = JSON.parse(resultText);
        } catch {
          toolResult = { status: 'error', data: resultText };
        }
        this.registry.execAfterToolCall(toolResult);

        try {
          if (toolResult.status === 'rejected_by_user') {
            console.log(`\n[!] [拦截] 您拒绝了此操作。已强行终止后续的连带工具调用，并唤醒大模型向您解释...`);
            isCommandRejected = true;
          } else if (toolResult.status === 'error') {
            console.log(`\nX [错误] 工具执行失败: ${toolResult.message}`);
          } else if (toolResult.status === 'success') {
            console.log(`\n[OK] [成功] 工具执行完毕。`);
          }
        } catch (e) {
          console.log(`\n(i)  [输出] ${resultText}`);
        }
        if (this.IS_DEBUG) {
          console.log(`[IN] [DEBUG] 工具返回结果喂给 AI:`, resultText);
        }

        this.messageHistory.push({
          role: 'tool',
          tool_call_id: rawToolCall.id,
          name: toolName,
          content: resultText,
        });

        if (isCommandRejected) {
          this.messageHistory.push({
            role: 'user',
            content: [
              "SYSTEM NOTICE: The user has just denied your last operation.",
              "For the next response, you are STRICTLY PROHIBITED from calling any tools (functions).",
              "Do not generate any 'tool_calls'. You must ONLY output plain text.",
              "Please explain the necessity of your previous action, apologize for the inconvenience, and provide alternative text-based solutions or manual instructions for the user to consider."
            ].join(' ')
          });
          break;
        }
      }
    }
  }
}
