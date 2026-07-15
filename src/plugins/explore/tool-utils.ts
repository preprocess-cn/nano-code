/**
 * tool-utils.ts
 *
 * 插件包装工具函数，用于构建只读子 agent（如 Explore agent）。
 *
 * createFilteredPlugin     — 只暴露指定工具子集，隐藏 Write/Patch 等写工具
 * createReadonlyCommandPlugin — 强制 Bash 只读，拦截非只读命令
 */

import { NanoPlugin } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';
import { isReadOnlyCommand } from '#src/plugins/tools/command-readonly.js';

/**
 * 包装插件，只暴露指定的工具子集。
 * 未在 allowedTools 中的工具不会被注册。
 */
export function createFilteredPlugin(
  plugin: NanoPlugin,
  allowedTools: Set<string>,
): NanoPlugin {
  return {
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,

    getTools(): ToolDefinition[] {
      return plugin.getTools().filter(t => allowedTools.has(t.function.name));
    },

    execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      return plugin.execute(name, args, ctx);
    },

    onInit: plugin.onInit?.bind(plugin),
    onDestroy: plugin.onDestroy?.bind(plugin),
    onSystemPrompt: plugin.onSystemPrompt?.bind(plugin),
    onBeforeRequest: plugin.onBeforeRequest?.bind(plugin),
    onAfterRequest: plugin.onAfterRequest?.bind(plugin),
    onBeforeToolCall: plugin.onBeforeToolCall?.bind(plugin),
    onAfterToolCall: plugin.onAfterToolCall?.bind(plugin),
    onBeforeAgentInput: plugin.onBeforeAgentInput?.bind(plugin),
    onExtraParams: plugin.onExtraParams?.bind(plugin),
    onAgentReady: plugin.onAgentReady?.bind(plugin),
    onAgentExit: plugin.onAgentExit?.bind(plugin),
    onSessionRestore: plugin.onSessionRestore?.bind(plugin),
  };
}

/**
 * 包装 command 插件，强制 Bash 只读。
 *
 * 子 agent 默认 skipPermission = true，sideEffect 检查被绕过。
 * 此包装在 execute() 层拦截非只读命令并返回错误。
 */
export function createReadonlyCommandPlugin(plugin: NanoPlugin): NanoPlugin {
  return {
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,

    getTools(): ToolDefinition[] {
      return plugin.getTools();
    },

    async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      if (name === 'run_bash_command' && typeof args?.command === 'string') {
        const cmd = args.command.trim();
        if (!isReadOnlyCommand(cmd)) {
          return {
            status: 'error',
            message: `[Explore 只读模式] 命令 "${cmd.slice(0, 80)}" 被拒绝：Explore agent 仅允许执行只读命令。如需写入操作请在主会话中执行。`,
          };
        }
      }
      return plugin.execute(name, args, ctx);
    },

    onInit: plugin.onInit?.bind(plugin),
    onDestroy: plugin.onDestroy?.bind(plugin),
    onSystemPrompt: plugin.onSystemPrompt?.bind(plugin),
    onBeforeRequest: plugin.onBeforeRequest?.bind(plugin),
    onAfterRequest: plugin.onAfterRequest?.bind(plugin),
    onBeforeToolCall: plugin.onBeforeToolCall?.bind(plugin),
    onAfterToolCall: plugin.onAfterToolCall?.bind(plugin),
    onBeforeAgentInput: plugin.onBeforeAgentInput?.bind(plugin),
    onExtraParams: plugin.onExtraParams?.bind(plugin),
    onAgentReady: plugin.onAgentReady?.bind(plugin),
    onAgentExit: plugin.onAgentExit?.bind(plugin),
    onSessionRestore: plugin.onSessionRestore?.bind(plugin),
  };
}
