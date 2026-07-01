import { NanoPlugin } from '../../core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from '../../core/contract.js';
import { ChatMessage } from '../../core/llm.js';
import { MessageBus } from './message-bus.js';

export interface AgentIdentity {
  taskId: string;
  agentName: string;
}

export function validateSendMessageArgs(args: any): ToolResponse | null {
  const { to, summary, message } = args || {};
  if (!to) return { status: 'error', message: '参数 to 不能为空' };
  if (!summary) return { status: 'error', message: '参数 summary 不能为空' };
  if (!message) return { status: 'error', message: '参数 message 不能为空' };
  return null;
}

/**
 * Create a `send_message` tool for a specific sub-agent identity.
 * Registered inside the sub-agent's PluginRegistry so the sub-agent
 * can send messages to other running agents.
 */
export function createAgentSendMessagePlugin(identity: AgentIdentity): NanoPlugin {
  return {
    name: `send-message:${identity.taskId}`,
    description: `send_message tool for ${identity.agentName}`,

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'send_message',
            description: '发送消息给另一个正在运行的 agent，包括主 agent。用于 agent 间协作。',
            parameters: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: '接收方 agent 名称（如 "main"、"dba"）或任务 ID（如 "task_3"）。发送 "main" 给主 agent。',
                },
                summary: {
                  type: 'string',
                  description: '消息摘要（一行，10 词以内）。',
                },
                message: {
                  type: 'string',
                  description: '消息正文。',
                },
              },
              required: ['to', 'summary', 'message'],
            },
            sideEffect: false,
          },
        },
      ];
    },

    async execute(
      _name: string,
      args: any,
      _ctx: ToolContext,
    ): Promise<ToolResponse> {
      const err = validateSendMessageArgs(args);
      if (err) return err;

      const { to, summary, message } = args || {};
      return MessageBus.getInstance().send(identity.taskId, identity.agentName, to, summary, message);
    },
  };
}

/**
 * Create a message delivery plugin for a sub-agent.
 * Injects pending mailbox messages before each LLM request.
 */
export function createMessageDeliveryPlugin(taskId: string): NanoPlugin {
  return {
    name: `msg-delivery:${taskId}`,

    getTools(): ToolDefinition[] {
      return [];
    },

    async execute(): Promise<ToolResponse> {
      return { status: 'error', message: 'no tools' };
    },

    onSystemPrompt(prompt: string): string {
      const bus = MessageBus.getInstance();
      const pending = bus.peek(taskId);
      if (pending.length === 0) return prompt;
      return (
        prompt +
        `\n\n## 新消息\n你收到了 ${pending.length} 条新消息。读取后可使用 send_message 回复。\n注意：本轮 LLM 请求时会自动注入消息内容。`
      );
    },

    onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
      const bus = MessageBus.getInstance();
      const newMessages = bus.receive(taskId);
      if (newMessages.length === 0) return messages;

      const formatted = newMessages
        .map(
          (m) =>
            `[来自 ${m.fromAgentName}: ${m.summary}]\n${m.content}`,
        )
        .join('\n\n---\n\n');

      const [system, ...rest] = messages;
      return [
        system,
        { role: 'user', content: `## 收到的消息\n\n你收到了来自其他 agent 的消息:\n\n${formatted}` },
        ...rest,
      ];
    },
  };
}
