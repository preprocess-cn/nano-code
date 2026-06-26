import { NanoPlugin, PluginRegistry } from '../../plugin.js';
import { CommandInterceptResult } from '../../contract.js';
import { DisplayManager } from '../../display.js';
import { NanoCodeAgent } from '../../agent.js';
import { NanoConfig } from '../../config.js';
import { parseSlashCommand } from './parser.js';
import { findBuiltinCommand, type BuiltinContext } from './builtin.js';

let _agent: NanoCodeAgent | undefined;
let _display: DisplayManager | undefined;
let _registry: PluginRegistry | undefined;
let _config: NanoConfig | undefined;

export function setCommandAgent(agent: NanoCodeAgent): void {
  _agent = agent;
}

export function createCommandsPlugin(display?: DisplayManager, registry?: PluginRegistry, config?: NanoConfig): NanoPlugin {
  _display = display;
  _registry = registry;
  _config = config;

  return {
    name: 'commands',
    description: '内建斜杠命令 — /exit, /clear, /help, /context',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'commands 插件不提供工具调用' }; },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      // 纯文本 exit/quit 也拦截（不要求 / 前缀）
      const lower = input.trim().toLowerCase();
      if (lower === 'exit' || lower === 'quit') {
        return { handled: true, exit: true };
      }

      if (!input.startsWith('/')) return null;

      const parsed = parseSlashCommand(input);
      if (!parsed) return null;

      const cmd = findBuiltinCommand(parsed.name);
      if (!cmd) return null;

      const ctx: BuiltinContext = {
        agent: _agent!,
        registry: _registry!,
        config: _config!,
        display: _display,
        args: parsed.args,
      };

      // /clear — 清空历史
      if (cmd.name === 'clear') {
        _agent?.clearHistory();
      }

      return cmd.handler(ctx);
    },
  };
}
