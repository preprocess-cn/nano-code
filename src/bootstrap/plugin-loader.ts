/**
 * 内置插件加载器 — 注册阶段调用，不参与运行时的 ReAct 循环。
 *
 * 职责：维护内置插件名称 → 构造函数的映射，按名实例化并注册到 PluginRegistry。
 *
 * 本文件位于 bootstrap 层而非 core 层，因为：
 * 插件注册属于启动初始化逻辑，运行时只需 PluginRegistry 类本身。
 */

import { PluginRegistry } from '#src/core/plugin.js';
import type { NanoPlugin } from '#src/core/plugin.js';

// ── Builtin plugin loaders ──

const BUILTIN_LOADERS: Record<string, (settings?: Record<string, any>) => Promise<NanoPlugin>> = {
  fs: async () => (await import('#src/plugins/tools/fs.js')).fsPlugin,
  command: async () => (await import('#src/plugins/tools/command.js')).commandPlugin,
  memory: async (s) => (await import('#src/plugins/tools/memory.js')).createMemoryPlugin(s || {}),
  'token-budget': async (s) => (await import('#src/plugins/token-budget/index.js')).createTokenBudgetPlugin(s || {}),
  skills: async (s) => (await import('#src/plugins/skills/index.js')).createSkillsPlugin(s?.llmClient, s?.displayMgr, s?.agentManager, { disabled: s?.disabled, disableSkillTool: s?.disableSkillTool }),
  'file-search': async () => (await import('#src/plugins/tools/search.js')).searchPlugin,
  web: async () => (await import('#src/plugins/tools/web.js')).webPlugin,
  'model-registry': async (s) => (await import('#src/plugins/model-registry/index.js')).createModelRegistryPlugin(s || {}),
  // ── Feature plugins (loaded via registerBuiltinPlugin) ──
  coordinator: async (s) => (await import('#src/plugins/coordinator/coordinator.js')).createAgentCoordinatorPlugin(s?.llmClient, s?.displayMgr, s?.agentManager),
  commands: async (s) => (await import('#src/plugins/commands/index.js')).createCommandsPlugin(s?.displayMgr),
  'skills-slash': async (s) => (await import('#src/plugins/commands/skills-slash.js')).createSkillsSlashPlugin(s?.llmClient, s?.displayMgr, s?.agentManager),
  'agent-slash': async () => (await import('#src/plugins/commands/agent-slash.js')).createAgentSlashPlugin(),
  bang: async (s) => (await import('#src/plugins/commands/bang.js')).createBangPlugin(s?.displayMgr),
  'task-plan': async () => (await import('#src/plugins/tools/task-plan.js')).taskPlanPlugin,
  'npm-loader': async () => (await import('#src/plugins/npm-loader.js')).npmLoaderPlugin,
  'ask-user-question': async () => (await import('#src/plugins/tools/ask-user-question.js')).askUserQuestionPlugin,
  'mcp-loader': async (s) => (await import('#src/plugins/mcp/adapter.js')).createMcpLoaderPlugin(s?.config, s?.debug),
  'notify-manager': async (s) => (await import('#src/plugins/notify-manager.js')).createNotifyManagerPlugin(s || {}),
  guidance: async (s) => (await import('#src/plugins/guidance/index.js')).createGuidancePlugin(s as Record<string, any> | undefined),
  permission: async () => (await import('#src/plugins/permission/index.js')).createPermissionPlugin(),
};

/**
 * 系统插件默认列表 — 自动注册且受保护（CLI enable/disable 不可操作）。
 * 用户可在 YAML 配置中通过 system_plugins 覆盖此列表。
 * 新增内置工具时：在此列表加一行即可（无需修改 config.ts）。
 */
export const DEFAULT_SYSTEM_PLUGINS: readonly string[] = [
  'fs',
  'command',
  'memory',
  'token-budget',
  'file-search',
  'mcp-loader',
  'permission',
];

/**
 * 默认 feature 插件列表 — 在系统插件之后注册，可接收 settings 传入运行时依赖。
 * 用户可在 YAML 配置中通过 plugins.<name>.enabled = false 禁用。
 */
export const DEFAULT_FEATURE_PLUGINS: readonly string[] = [
  'skills',
  'coordinator',
  'commands',
  'skills-slash',
  'agent-slash',
  'bang',
  'task-plan',
  'ask-user-question',
  'npm-loader',
  'guidance',
];

/**
 * 按内置名注册一个插件。
 * 新增内置工具：在 BUILTIN_LOADERS + DEFAULT_SYSTEM_PLUGINS 各加一行即可。
 * @returns true 表示已注册，false 表示名称未识别（调用方应忽略或警告）。
 */
export async function registerBuiltinPlugin(
  registry: PluginRegistry,
  name: string,
  settings?: Record<string, any>,
  transform?: (plugin: NanoPlugin) => NanoPlugin,
): Promise<boolean> {
  const loader = BUILTIN_LOADERS[name];
  if (!loader) return false;

  if (settings) registry.setPluginConfig(name, settings);
  let plugin = await loader(settings);
  if (transform) plugin = transform(plugin);
  await registry.register(plugin);
  return true;
}
