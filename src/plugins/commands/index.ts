import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { CommandInterceptResult } from '#src/core/contract.js';
import type { DisplayOutput, DisplayInteractive } from '#src/display.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import type { NanoConfig } from '#src/core/config.js';
import { parseSlashCommand } from '#src/plugins/commands/parser.js';
import { findBuiltinCommand, type BuiltinContext } from '#src/plugins/commands/builtin.js';

let _agent: NanoCodeAgent | undefined;
let _display: (DisplayOutput & DisplayInteractive) | undefined;
let _registry: PluginRegistry | undefined;
let _config: NanoConfig | undefined;

export function createCommandsPlugin(display?: DisplayOutput & DisplayInteractive): NanoPlugin {
  _display = display;

  return {
    name: 'commands',
    description: '内建斜杠命令 — /exit, /clear, /help, /context',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'commands 插件不提供工具调用' }; },

    onInit(registry: PluginRegistry): Promise<void> {
      _registry = registry;
      const cfg = registry.getPluginConfig('commands');
      _config = cfg?.config as NanoConfig | undefined;
      return Promise.resolve();
    },

    async onAgentReady(ctx) {
      _agent = ctx.agent;
    },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      const lower = input.trim().toLowerCase();
      // 纯文本 exit/quit 也拦截（不要求 / 前缀）
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
