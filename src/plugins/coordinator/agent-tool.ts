import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { registerBuiltinPlugin } from '#src/bootstrap/plugin-loader.js';
import { ToolResponse, ToolContext, ToolDefinition, type AgentDisplay } from '#src/core/contract.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { AgentManager } from '#src/core/agent-manager.js';
import { LLMClient } from '#src/core/llm.js';
import { AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';
import { AgentLifecycle } from '#src/plugins/coordinator/lifecycle.js';
import { SK } from '#src/store-keys.js';

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

  // 抑制子 agent 工具 stdout/stderr 直写终端（否则会破坏 Ink alt-screen）。
  // 工具输出仍被 result 捕获，通过消息历史展示。
  subRegistry.setOutputHandler({ stdout() {}, stderr() {} });

  return subRegistry;
}

export function createAgentToolPlugin(
  def: AgentDefinition,
  llmClient: LLMClient,
  display?: AgentDisplay,
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

      // 同步执行子 agent
      const lifecycle = AgentLifecycle.getInstance();
      const controllerId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const subRegistry = await createSubRegistry(def, agentManager?.getStore(), options);

      const agentName = `${def.name}_sync_${controllerId.slice(0, 8)}`;
      const subAgent = agentManager
        ? agentManager.createAgent({ registry: subRegistry, agentRole: def.role, description: def.description, promptConfig: def.systemPrompt, name: agentName, display, abortController: lifecycle.createTaskController(controllerId), maxTurns: def.maxTurns })
        : new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, description: def.description, promptConfig: def.systemPrompt, name: def.name, display, abortController: lifecycle.createTaskController(controllerId), maxTurns: def.maxTurns });

      try {
        const result = await subAgent.runTask(query);
        return {
          status: 'success',
          data: result || '(子 agent 未返回内容)',
        };
      } finally {
        const actualName = subAgent.getName();
        // Cleanup per-agent token key in shared store
        const removeAgent = subRegistry.store.get<(name: string) => void>(SK.TokenBudgetRemoveAgent);
        removeAgent?.(actualName);
        if (agentManager) agentManager.removeAgent(actualName);
        lifecycle.cleanup(controllerId);
      }
    },
  };
}
