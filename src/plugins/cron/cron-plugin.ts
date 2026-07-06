import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';
import { ChatMessage } from '#src/core/llm.js';
import { CronScheduler } from '#src/plugins/cron/cron-scheduler.js';

export const cronPlugin: NanoPlugin = {
  name: 'cron',
  description: 'Cron 定时任务管理 — 创建、删除、列出定时任务',

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'cron_create',
          description: `创建一个定时任务，在指定时间触发时向 LLM 注入消息。
适用于定时期望 AI 执行的操作、提醒等场景。

- cron 参数为标准 5 字段 cron 表达式（如 "*/5 * * * *" = 每 5 分钟）
- prompt 为触发时注入的消息内容
- recurring=true 表示循环触发，false 表示仅触发一次后自动删除
- durable=true 表示跨会话持久化（重启后仍生效）
- 最多 50 个任务
- 循环任务 7 天后自动过期`,
          parameters: {
            type: 'object',
            properties: {
              cron: {
                type: 'string',
                description: '标准 5 字段 cron 表达式，如 "*/5 * * * *"',
              },
              prompt: {
                type: 'string',
                description: '触发时注入的消息内容',
              },
              description: {
                type: 'string',
                description: '可选的任务描述（方便列表查看）',
              },
              recurring: {
                type: 'boolean',
                description: '是否循环触发，默认 true',
                default: true,
              },
              durable: {
                type: 'boolean',
                description: '是否跨会话持久化（写入 .nano-code/cron-tasks.json），默认 false',
                default: false,
              },
            },
            required: ['cron', 'prompt'],
          },
          sideEffect: true,
        },
      },
      {
        type: 'function',
        function: {
          name: 'cron_delete',
          description: '删除一个定时任务',
          parameters: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '要删除的任务 ID',
              },
            },
            required: ['id'],
          },
          sideEffect: true,
        },
      },
      {
        type: 'function',
        function: {
          name: 'cron_list',
          description: '列出所有定时任务',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
          sideEffect: false,
        },
      },
    ];
  },

  async execute(name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
    const scheduler = CronScheduler.getInstance();

    switch (name) {
      case 'cron_create': {
        const result = scheduler.createTask({
          cron: args.cron,
          prompt: args.prompt,
          description: args.description,
          recurring: args.recurring !== false,
          durable: args.durable === true,
        });
        if ('error' in result) {
          return { status: 'error', message: result.error };
        }
        return {
          status: 'success',
          message: `定时任务已创建 (ID: ${result.id})`,
          data: JSON.stringify({
            id: result.id,
            cron: result.cron,
            prompt: result.prompt,
            description: result.description,
            recurring: result.recurring,
            durable: result.durable,
          }),
        };
      }

      case 'cron_delete': {
        const ok = scheduler.deleteTask(args.id);
        if (!ok) {
          return { status: 'error', message: `任务 "${args.id}" 不存在或已删除` };
        }
        return { status: 'success', message: `任务 "${args.id}" 已删除` };
      }

      case 'cron_list': {
        const tasks = scheduler.listTasks();
        return {
          status: 'success',
          data: JSON.stringify({ count: tasks.length, tasks }),
        };
      }

      default:
        return { status: 'error', message: `未知工具: ${name}` };
    }
  },

  onInit(_registry: PluginRegistry): Promise<void> {
    CronScheduler.getInstance().initialize();
    return Promise.resolve();
  },

  onDestroy(): Promise<void> {
    CronScheduler.getInstance().cancelAll();
    return Promise.resolve();
  },

  onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
    const scheduler = CronScheduler.getInstance();
    const fired = scheduler.drainFired();
    if (fired.length === 0) return messages;

    const now = new Date();
    const content = fired
      .map(t => `⏰ 定时任务触发 (ID: ${t.id}, ${now.toLocaleString()})\n${t.prompt}`)
      .join('\n\n---\n\n');

    const extraMessages: ChatMessage[] = [{
      role: 'user',
      content,
      isMeta: true,
    }];

    // 追加到末尾，不破坏 system prompt 之后的缓存前缀
    return [...messages, ...extraMessages];
  },

  onAfterRequest(_response: any): void {
    CronScheduler.getInstance().clearInjectedSinceFire();
  },
};
