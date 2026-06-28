import { NanoPlugin, PluginRegistry, registerBuiltinPlugin } from './plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from './contract.js';
import { NanoCodeAgent } from './agent.js';
import { LLMClient } from './llm.js';
import { AgentDefinition } from './agent-loader.js';
import { DisplayManager } from './display.js';

export function createAgentToolPlugin(
  def: AgentDefinition,
  llmClient: LLMClient,
  display?: DisplayManager,
): NanoPlugin {
  return {
    name: `agent:${def.name}`,
    description: def.description,

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
            },
            required: ['query'],
          },
        },
      }];
    },

    async execute(_name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
      const query = args.query || '';
      if (!query) {
        return { status: 'error', message: 'query 参数不能为空' };
      }

      // Create independent plugin registry for sub-agent
      const subRegistry = new PluginRegistry();
      subRegistry.setAgentName(def.name);
      subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

      // Register plugins from agent definition (no agent tools → recursive guard)
      if (def.plugins) {
        for (const [name, pluginCfg] of Object.entries(def.plugins)) {
          if (pluginCfg?.enabled === false) continue;
          await registerBuiltinPlugin(subRegistry, name, pluginCfg?.settings);
        }
      }

      // Create and run sub-agent
      const subAgent = new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: def.role, promptConfig: def.systemPrompt, name: def.name, display });

      const result = await subAgent.runTask(query);

      return {
        status: 'success',
        data: result || '(子 agent 未返回内容)',
      };
    },
  };
}
