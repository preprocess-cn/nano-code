import { NanoPlugin, PluginRegistry, registerBuiltinPlugin } from './core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from './core/contract.js';
import { NanoCodeAgent } from './core/agent.js';
import { LLMClient } from './core/llm.js';
import { AgentDefinition } from './agent-loader.js';
import { DisplayManager } from './display.js';
import { BackgroundTaskManager } from './background-task-manager.js';
import { MessageBus } from './agent-message-bus.js';
import {
  createAgentSendMessagePlugin,
  createMessageDeliveryPlugin,
  type AgentIdentity,
} from './agent-coordinator.js';

export function createAgentToolPlugin(
  def: AgentDefinition,
  llmClient: LLMClient,
  display?: DisplayManager,
): NanoPlugin {
  return {
    name: `agent:${def.name}`,
    description: def.description,

    onSystemPrompt(prompt: string): string {
      // 只 append 自己的条目，header 由 coordinator 管理。若 header 尚不存在则添加。
      if (prompt.includes(`agent-${def.name}`)) return prompt;
      const header = '\n\n## Specialist Agents\n你可以将任务委托给以下 specialist agent；需要耗时任务可设置 run_in_background=true 异步执行。';
      const entry = `- agent-${def.name}: ${def.description}`;
      if (prompt.includes('## Specialist Agents')) {
        return prompt + '\n' + entry;
      }
      return prompt + header + '\n' + entry;
    },

    getTools(): ToolDefinition[] {
      return [{
        type: 'function',
        function: {
          name: `agent-${def.name}`,
          description: def.description,
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: `向 ${def.name}（${def.description}）提出的问题或任务描述`,
              },
              run_in_background: {
                type: 'boolean',
                description: '是否在后台异步执行。如果为 true，立即返回 taskId，主 agent 可继续处理其他任务。',
              },
            },
            required: ['query'],
          },
          sideEffect: false,
        },
      }];
    },

    async execute(_name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
      const query = args.query || '';
      if (!query) {
        return { status: 'error', message: 'query 参数不能为空' };
      }

      const runInBackground = args.run_in_background === true;

      if (runInBackground) {
        // Background execution: start task and return immediately
        const manager = BackgroundTaskManager.getInstance();
        const taskId = manager.startTask(def.name, query, async (assignedTaskId) => {
          try {
            const subRegistry = new PluginRegistry();
            subRegistry.setAgentName(def.name);
            subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

            if (def.plugins) {
              for (const [name, pluginCfg] of Object.entries(def.plugins)) {
                if (pluginCfg?.enabled === false) continue;
                await registerBuiltinPlugin(subRegistry, name, pluginCfg?.settings);
              }
            }

            // Phase 3: Register inter-agent communication plugins
            const identity: AgentIdentity = { taskId: assignedTaskId, agentName: def.name };
            await subRegistry.register(createAgentSendMessagePlugin(identity));
            await subRegistry.register(createMessageDeliveryPlugin(assignedTaskId));

            // Background agents run headless (no display)
            const subAgent = new NanoCodeAgent({
              registry: subRegistry,
              llmClient,
              agentRole: def.role,
              promptConfig: def.systemPrompt,
              name: def.name,
            });

            return await subAgent.runTask(query);
          } finally {
            MessageBus.getInstance().unregisterAgent(assignedTaskId);
          }
        });

        // Register in MessageBus immediately so the agent is addressable from the start
        MessageBus.getInstance().registerAgent(taskId, def.name);

        display?.onBackgroundTask?.({
          agentName: def.name,
          taskId,
          taskStatus: 'started',
          message: `${def.name}（${taskId}）已启动${query ? ': ' + query.slice(0, 60) : ''}`,
        });

        return {
          status: 'success',
          data: JSON.stringify({
            taskId,
            agentName: def.name,
            status: 'started',
            message: `Agent "${def.name}" 已在后台启动（${taskId}）。可用 agent_task_status 查询进度，完成后会自动收到通知。`,
          }),
        };
      }

      // Synchronous execution
      const subRegistry = new PluginRegistry();
      subRegistry.setAgentName(def.name);
      subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

      if (def.plugins) {
        for (const [name, pluginCfg] of Object.entries(def.plugins)) {
          if (pluginCfg?.enabled === false) continue;
          await registerBuiltinPlugin(subRegistry, name, pluginCfg?.settings);
        }
      }

      const subAgent = new NanoCodeAgent({
        registry: subRegistry,
        llmClient,
        agentRole: def.role,
        promptConfig: def.systemPrompt,
        name: def.name,
        display,
      });

      const result = await subAgent.runTask(query);

      return {
        status: 'success',
        data: result || '(子 agent 未返回内容)',
      };
    },
  };
}
