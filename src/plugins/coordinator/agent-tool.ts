import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { registerBuiltinPlugin } from '#src/bootstrap/plugin-loader.js';
import { ToolResponse, ToolContext, ToolDefinition, type AgentDisplay } from '#src/core/contract.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { AgentManager } from '#src/core/agent-manager.js';
import { LLMClient } from '#src/core/llm.js';
import { AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';
import type { DisplayBackgroundTask } from '#src/display.js';
import { BackgroundTaskManager } from '#src/plugins/coordinator/task-manager.js';
import { AgentLifecycle } from '#src/plugins/coordinator/lifecycle.js';
import { MessageBus } from '#src/plugins/coordinator/message-bus.js';
import {
  createAgentSendMessagePlugin,
  createMessageDeliveryPlugin,
  type AgentIdentity,
} from '#src/plugins/coordinator/messaging-plugins.js';

/** createSubRegistry 的额外选项 */
export interface SubRegistryOptions {
  /** 按插件名注册前对插件实例进行 transform */
  pluginTransforms?: Record<string, (plugin: NanoPlugin) => NanoPlugin>;
}

async function createSubRegistry(
  def: AgentDefinition,
  store?: import('#src/core/store.js').IStore,
  options?: SubRegistryOptions,
): Promise<PluginRegistry> {
  const subRegistry = store ? new PluginRegistry({ store }) : new PluginRegistry();
  subRegistry.setAgentName(def.name);
  subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

  if (def.plugins) {
    for (const [name, pluginCfg] of Object.entries(def.plugins)) {
      if (pluginCfg?.enabled === false) continue;
      const transform = options?.pluginTransforms?.[name];
      await registerBuiltinPlugin(subRegistry, name, pluginCfg?.settings, transform);
    }
  }

  return subRegistry;
}

/**
 * 读取 auto-background 阈值。通过 NANO_AUTO_BACKGROUND_TASKS 或 CLAUDE_AUTO_BACKGROUND_TASKS 环境变量控制。
 * 值为正整数的毫秒数。未设置或值为 0 时禁用 auto-background。
 */
function getAutoBackgroundMs(): number {
  const envVal = process.env.NANO_AUTO_BACKGROUND_TASKS || process.env.CLAUDE_AUTO_BACKGROUND_TASKS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function createAgentToolPlugin(
  def: AgentDefinition,
  llmClient: LLMClient,
  display?: AgentDisplay & DisplayBackgroundTask,
  agentManager?: AgentManager,
  options?: SubRegistryOptions,
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
            const subRegistry = await createSubRegistry(def, agentManager?.getStore(), options);

            // Register inter-agent communication plugins
            const identity: AgentIdentity = { taskId: assignedTaskId, agentName: def.name };
            await subRegistry.register(createAgentSendMessagePlugin(identity));
            await subRegistry.register(createMessageDeliveryPlugin(assignedTaskId));

            // Background agents run headless (no display)
            const agentName = `${def.name}_bg_${assignedTaskId}`;
            const subAgent = agentManager
              ? agentManager.createAgent({ registry: subRegistry, agentRole: def.role, promptConfig: def.systemPrompt, name: agentName, abortController: taskController, maxTurns: def.maxTurns })
              : new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, promptConfig: def.systemPrompt, name: def.name, abortController: taskController, maxTurns: def.maxTurns });

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

      // Synchronous execution with auto-background support.
      // When the env var is set and the sub-agent runs longer than the threshold,
      // it is auto-converted to a background task instead of being killed.
      const lifecycle = AgentLifecycle.getInstance();
      const syncControllerId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const subRegistry = await createSubRegistry(def, agentManager?.getStore(), options);

      const agentName = `${def.name}_sync_${syncControllerId.slice(0, 8)}`;
      const subAgent = agentManager
        ? agentManager.createAgent({ registry: subRegistry, agentRole: def.role, promptConfig: def.systemPrompt, name: agentName, display, abortController: lifecycle.createTaskController(syncControllerId), maxTurns: def.maxTurns })
        : new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, promptConfig: def.systemPrompt, name: def.name, display, abortController: lifecycle.createTaskController(syncControllerId), maxTurns: def.maxTurns });

      const autoBgMs = getAutoBackgroundMs();
      let wasBackgrounded = false;
      let bgTaskId: string | null = null;
      let bgError: string | null = null;

      // Capture the promise so the background callback can await the same result
      const runTaskPromise = subAgent.runTask(query);

      // Shared cleanup for non-backgrounded paths
      const cleanupSync = () => {
        if (agentManager) agentManager.removeAgent(subAgent.getName());
        lifecycle.cleanup(syncControllerId);
      };

      // Auto-background timer: fires when the sub-agent runs too long
      const autoBgTimer = autoBgMs > 0 ? setTimeout(() => {
        try {
          wasBackgrounded = true;
          const manager = BackgroundTaskManager.getInstance();
          bgTaskId = manager.startTask(def.name, query, async (assignedTaskId) => {
            // Register messaging plugins so the background agent is addressable
            const identity: AgentIdentity = { taskId: assignedTaskId, agentName: def.name };
            await subRegistry.register(createAgentSendMessagePlugin(identity));
            await subRegistry.register(createMessageDeliveryPlugin(assignedTaskId));
            MessageBus.getInstance().registerAgent(assignedTaskId, def.name);

            display?.onBackgroundTask?.({
              agentName: def.name,
              taskId: assignedTaskId,
              taskStatus: 'started',
              message: `${def.name}（${assignedTaskId}）已超时自动转入后台${query ? ': ' + query.slice(0, 60) : ''}`,
            });

            try {
              return await runTaskPromise;
            } finally {
              if (agentManager) agentManager.removeAgent(subAgent.getName());
              MessageBus.getInstance().unregisterAgent(assignedTaskId);
              lifecycle.cleanup(syncControllerId);
              lifecycle.cleanup(assignedTaskId);
            }
          });
        } catch (timerErr) {
          bgError = timerErr instanceof Error ? timerErr.message : String(timerErr);
        }
      }, autoBgMs) : null;

      try {
        const result = await runTaskPromise;
        if (autoBgTimer) clearTimeout(autoBgTimer);

        if (wasBackgrounded) {
          return {
            status: 'success',
            data: JSON.stringify({
              taskId: bgTaskId,
              agentName: def.name,
              status: 'started',
              message: `Agent "${def.name}" 执行超时，已自动转入后台（${bgTaskId}）。可用 agent_task_status 查询进度，完成后会自动收到通知。`,
            }),
          };
        }

        if (bgError) {
          return {
            status: 'error',
            message: `Agent "${def.name}" 自动转入后台失败：${bgError}`,
          };
        }

        // Normal sync completion
        cleanupSync();

        return {
          status: 'success',
          data: result || '(子 agent 未返回内容)',
        };
      } catch (err) {
        if (autoBgTimer) clearTimeout(autoBgTimer);
        if (!wasBackgrounded) {
          cleanupSync();
        }
        if (wasBackgrounded) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            status: 'error',
            message: `Agent "${def.name}" 自动转入后台后执行出错：${errMsg}`,
          };
        }
        throw err;
      }
    },
  };
}
