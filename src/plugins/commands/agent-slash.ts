import { NanoPlugin } from '../../plugin.js';
import { CommandInterceptResult } from '../../contract.js';
import { NanoCodeAgent } from '../../agent.js';
import { DisplayManager } from '../../display.js';
import { loadAgentDefinitions } from '../../agent-loader.js';
import type { SystemPromptConfig } from '../../config.js';

export interface AgentModeInfo {
  name: string;
  description: string;
}

let _agent: NanoCodeAgent | null = null;
let _display: DisplayManager | null = null;
let _currentAgentMode: AgentModeInfo | null = null;

export function getCurrentAgentMode(): AgentModeInfo | null {
  return _currentAgentMode;
}

export function setTargetAgent(agent: NanoCodeAgent, display?: DisplayManager): void {
  _agent = agent;
  _display = display ?? null;
}

/** 测试用：重置模块级状态 */
export function _resetState(): void {
  _agent = null;
  _display = null;
  _currentAgentMode = null;
}

export function createAgentSlashPlugin(display?: DisplayManager, agentDir?: string): NanoPlugin {
  _display = display ?? null;

  return {
    name: 'agent-slash',
    description: '切换工具型 agent — /<agent名>',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'agent-slash 插件不提供工具调用' }; },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      if (!input.startsWith('/')) return null;

      const rest = input.slice(1).trim();
      const spaceIdx = rest.indexOf(' ');
      const cmdName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);

      // /main — 切回主模式
      if (cmdName === 'main' || cmdName === 'default') {
        if (!_agent) return null;
        _agent.setRole(undefined, undefined);
        _currentAgentMode = null;
        _display?.onStatus({ message: '已切换回主模式', agentName: 'main' });
        return { handled: true, skipAgent: true };
      }

      const agents = loadAgentDefinitions(agentDir);
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
      _currentAgentMode = { name: def.name, description: def.description };

      _display?.onStatus({ message: `已切换到 agent: ${def.name}（${def.description}）`, agentName: 'main' });

      return { handled: true, skipAgent: true };
    },
  };
}
