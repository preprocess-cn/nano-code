import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { CommandInterceptResult } from '#src/core/contract.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import type { DisplayOutput } from '#src/display.js';
import { loadAgentDefinitions } from '#src/plugins/coordinator/agent-loader.js';
import type { SystemPromptConfig } from '#src/core/config.js';
import { SK, type AgentModeInfo } from '#src/core/store-keys.js';

let _agent: NanoCodeAgent | null = null;
let _display: DisplayOutput | null = null;
let _registry: PluginRegistry | null = null;
let _agentDir: string | undefined;

/** 测试用：重置模块级状态 */
export function _resetState(): void {
  _agent = null;
  _display = null;
  _registry = null;
  _agentDir = undefined;
}

export function createAgentSlashPlugin(): NanoPlugin {
  return {
    name: 'agent-slash',
    description: '切换工具型 agent — /<agent名>',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'agent-slash 插件不提供工具调用' }; },

    onInit(registry: PluginRegistry): Promise<void> {
      _registry = registry;
      const cfg = registry.getPluginConfig('agent-slash');
      if (cfg?.agentDir) _agentDir = cfg.agentDir;
      return Promise.resolve();
    },

    async onAgentReady(ctx) {
      _agent = ctx.agent;
      _display = ctx.display;
    },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      if (!input.startsWith('/')) return null;

      const rest = input.slice(1).trim();
      const spaceIdx = rest.indexOf(' ');
      const cmdName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);

      // /main — 切回主模式
      if (cmdName === 'main' || cmdName === 'default') {
        if (!_agent) return null;
        _agent.setRole(undefined, undefined);
        if (_registry) _registry.store.set(SK.AgentMode, undefined);
        _display?.onStatus({ message: '已切换回主模式', agentName: 'main', level: 'info' });
        return { handled: true, skipAgent: true };
      }

      const agents = loadAgentDefinitions(_agentDir);
      const def = agents.find(a => a.name === cmdName);
      if (!def) return null; // fall through to skills-slash / commands

      if (!_agent) return null;

      const promptConfig: SystemPromptConfig | undefined = def.systemPrompt
        ? {
            withTools: def.systemPrompt.withTools,
            noTools: def.systemPrompt.noTools,
            projectFiles: def.systemPrompt.projectFiles,
          }
        : undefined;

      _agent.setRole(def.role, promptConfig);
      const modeInfo: AgentModeInfo = { name: def.name, description: def.description };
      if (_registry) _registry.store.set(SK.AgentMode, modeInfo);

      _display?.onStatus({ message: `已切换到 agent: ${def.name}（${def.description}）`, agentName: 'main', level: 'info' });

      return { handled: true, skipAgent: true };
    },
  };
}
