import { NanoPlugin, PluginRegistry, registerBuiltinPlugin } from '#src/core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from '#src/core/contract.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { AgentManager } from '#src/core/agent-manager.js';
import { LLMClient } from '#src/core/llm.js';
import { AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';
import { DisplayManager } from '#src/display.js';
import { BackgroundTaskManager } from '#src/plugins/coordinator/task-manager.js';
import { AgentLifecycle } from '#src/plugins/coordinator/lifecycle.js';
import { MessageBus } from '#src/plugins/coordinator/message-bus.js';
import {
  createAgentSendMessagePlugin,
  createMessageDeliveryPlugin,
  type AgentIdentity,
} from '#src/plugins/coordinator/messaging-plugins.js';

async function createSubRegistry(def: AgentDefinition, store?: import('#src/core/store.js').IStore): Promise<PluginRegistry> {
  const subRegistry = store ? new PluginRegistry({ store }) : new PluginRegistry();
  subRegistry.setAgentName(def.name);
  subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

  if (def.plugins) {
    for (const [name, pluginCfg] of Object.entries(def.plugins)) {
      if (pluginCfg?.enabled === false) continue;
      await registerBuiltinPlugin(subRegistry, name, pluginCfg?.settings);
    }
  }

  return subRegistry;
}

export function createAgentToolPlugin(
  def: AgentDefinition,
  llmClient: LLMClient,
  display?: DisplayManager,
  agentManager?: AgentManager,
): NanoPlugin {
  return {
    name: `agent:${def.name}`,
    description: def.description,

    getTools(): ToolDefinition[] {
      return [{
        type: 'function',
        function: {
          name: `agent-${def.name}`,
          displayName: def.name.charAt(0).toUpperCase() + def.name.slice(1),
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
        const lifecycle = AgentLifecycle.getInstance();

        const taskId = manager.startTask(def.name, query, async (assignedTaskId) => {
          // 使用 BackgroundTaskManager 的 taskId 创建生命周期控制器，与 cancelTask 的 key 一致
          const taskController = lifecycle.createTaskController(assignedTaskId);
          try {
            const subRegistry = await createSubRegistry(def, agentManager?.getStore());

            // Register inter-agent communication plugins
            const identity: AgentIdentity = { taskId: assignedTaskId, agentName: def.name };
            await subRegistry.register(createAgentSendMessagePlugin(identity));
            await subRegistry.register(createMessageDeliveryPlugin(assignedTaskId));

            // Background agents run headless (no display)
            const agentName = `${def.name}_bg_${assignedTaskId}`;
            const subAgent = agentManager
              ? agentManager.createAgent({ registry: subRegistry, agentRole: def.role, promptConfig: def.systemPrompt, name: agentName, abortController: taskController })
              : new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, promptConfig: def.systemPrompt, name: def.name, abortController: taskController });

            try {
              return await subAgent.runTask(query);
            } finally {
              if (agentManager) agentManager.removeAgent(subAgent.getName());
            }
          } finally {
            MessageBus.getInstance().unregisterAgent(assignedTaskId);
            lifecycle.cleanup(assignedTaskId);
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
      const lifecycle = AgentLifecycle.getInstance();
      const syncControllerId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const subRegistry = await createSubRegistry(def, agentManager?.getStore());

      const agentName = `${def.name}_sync_${syncControllerId.slice(0, 8)}`;
      const subAgent = agentManager
        ? agentManager.createAgent({ registry: subRegistry, agentRole: def.role, promptConfig: def.systemPrompt, name: agentName, display, abortController: lifecycle.createTaskController(syncControllerId) })
        : new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, promptConfig: def.systemPrompt, name: def.name, display, abortController: lifecycle.createTaskController(syncControllerId) });

      let result;
      try {
        result = await subAgent.runTask(query);
      } finally {
        if (agentManager) agentManager.removeAgent(subAgent.getName());
        lifecycle.cleanup(syncControllerId);
      }

      return {
        status: 'success',
        data: result || '(子 agent 未返回内容)',
      };
    },
  };
}
