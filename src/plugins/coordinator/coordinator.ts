import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from '#src/core/contract.js';
import { LLMClient, ChatMessage } from '#src/core/llm.js';
import { DisplayManager } from '#src/display.js';
import { loadAgentDefinitions, AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';
import { createAgentToolPlugin } from '#src/plugins/coordinator/agent-tool.js';
import { BackgroundTaskManager } from '#src/plugins/coordinator/task-manager.js';
import { MessageBus } from '#src/plugins/coordinator/message-bus.js';
import { validateSendMessageArgs } from '#src/plugins/coordinator/messaging-plugins.js';

export function createAgentCoordinatorPlugin(
  llmClient: LLMClient,
  displayMgr?: DisplayManager,
): NanoPlugin {
  const defs = loadAgentDefinitions().filter((d) => d.enabled !== false);

  return {
    name: 'agent-coordinator',
    description: 'Multi-agent coordination — listing, task status, background execution, and inter-agent messaging',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'agent_task_status',
            description: '查询后台运行的 agent 任务状态。传 task_id 查单个，不传返回全部。',
            parameters: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: '可选。指定查询的任务 ID。',
                },
              },
            },
            sideEffect: false,
          },
        },
        {
          type: 'function',
          function: {
            name: 'send_message',
            description: '发送消息给另一个正在运行的 agent。用于 agent 间协作——传递上下文、请求协助或通知结果。',
            parameters: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: '接收方，可以是 agent 名称（如 "dba"）或任务 ID（如 "task_3"）。',
                },
                summary: {
                  type: 'string',
                  description: '消息摘要（一行，10 词以内），收件人可见。',
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
      name: string,
      args: any,
      _ctx: ToolContext,
    ): Promise<ToolResponse> {
      if (name === 'agent_task_status') {
        const manager = BackgroundTaskManager.getInstance();
        if (args?.task_id) {
          const task = manager.getTask(args.task_id);
          if (!task) {
            return { status: 'error', message: `任务 "${args.task_id}" 不存在` };
          }
          return { status: 'success', data: JSON.stringify(task) };
        }
        const all = manager.listTasks();
        return { status: 'success', data: JSON.stringify(all) };
      }

      if (name === 'send_message') {
        const err = validateSendMessageArgs(args);
        if (err) return err;

        const { to, summary, message } = args || {};
        return MessageBus.getInstance().send('main', 'main', to, summary, message);
      }

      return { status: 'error', message: `未知工具: ${name}` };
    },

    async onInit(registry: PluginRegistry): Promise<void> {
      // Register main agent so other agents can send messages to it
      MessageBus.getInstance().registerAgent('main', 'main');

      for (const def of defs) {
        const plugin = createAgentToolPlugin(def, llmClient, displayMgr);
        await registry.register(plugin);
      }
    },

    onSystemPrompt(prompt: string): string {
      let result = prompt;

      if (defs.length > 0) {
        const entries = defs
          .map(
            (d) =>
              `- agent-${d.name}: ${d.description} — 使用 agent-${d.name}({ query, run_in_background? }) 调用`,
          )
          .join('\n');
        result += `\n\n## Specialist Agents\n你可以将任务委托给以下 specialist agent：\n${entries}\n\n### 同步 vs 后台\n- 默认同步：等待子 agent 返回后再继续\n- run_in_background=true：子 agent 在后台异步执行，你可以继续处理其他任务\n  后台任务完成后会自动收到通知。可用 agent_task_status 查询进度。\n\n### 并发\n- 可同时启动多个后台 agent\n- 每个 agent 独立执行，互不干扰\n- 完成后结果会自动注入到对话中\n\n### Agent 间通信\n- 使用 send_message({to, summary, message}) 发送消息给其他 agent\n- to 可以是 agent 名称（如 "dba"）或任务 ID（如 "task_3"）\n- 运行中的 agent 也可以回复你`;
      }

      const running = BackgroundTaskManager.getInstance()
        .listTasks()
        .filter((t) => t.status === 'running');
      if (running.length > 0) {
        const taskList = running
          .map((t) => `- ${t.taskId}: agent "${t.agentName}" — "${t.query.slice(0, 80)}"`)
          .join('\n');
        result += `\n\n## Running Background Tasks\n${taskList}\n\n可使用 agent_task_status 查询具体进度，或用 send_message 发送消息给正在运行的 agent。\n注意：不要重复启动已运行中的 agent！`;
      }

      return result;
    },

    onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
      const manager = BackgroundTaskManager.getInstance();
      const extraMessages: string[] = [];

      // Completed task notifications
      const completed = manager.getCompletedTasks();
      if (completed.length > 0) {
        // Emit display events for completed/errored background tasks
        for (const t of completed) {
          displayMgr?.onBackgroundTask?.({
            agentName: t.agentName,
            taskId: t.taskId,
            taskStatus: t.status === 'completed' ? 'completed' : 'error',
            message: `${t.agentName}（${t.taskId}）${t.status === 'completed' ? '已完成' : '失败'}`,
          });
        }
        const notifications = completed
          .map((t) => {
            const statusStr = t.status === 'completed' ? '✅ 完成' : '❌ 失败';
            const detail = t.result
              ? `结果: ${t.result.slice(0, 500)}`
              : t.error
                ? `错误: ${t.error}`
                : '';
            return `**后台任务: ${t.agentName}** (${t.taskId})\n状态: ${statusStr}\n${detail}`;
          })
          .join('\n\n---\n\n');
        extraMessages.push(`## 已完成的后台任务\n\n以下后台任务已完成:\n\n${notifications}`);
      }

      // Phase 3: Messages from other agents for the main agent
      const bus = MessageBus.getInstance();
      const mainMessages = bus.receiveUpTo('main', 5); // Cap at 5 per design constraints
      if (mainMessages.length > 0) {
        const formatted = mainMessages
          .map(
            (m) =>
              `[来自 ${m.fromAgentName}: ${m.summary}]\n${m.content}`,
          )
          .join('\n\n---\n\n');
        extraMessages.push(`## agent 发来的消息\n\n你收到了来自其他 agent 的消息:\n\n${formatted}`);
      }

      if (extraMessages.length === 0) return messages;

      const [system, ...rest] = messages;
      return [
        system,
        ...extraMessages.map((content) => ({
          role: 'user' as const,
          content,
        })),
        ...rest,
      ];
    },
  };
}
