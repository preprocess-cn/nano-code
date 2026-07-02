import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';

/**
 * npm 插件加载器。
 *
 * 通过动态 import() 加载 npm 包并将其注册为 NanoPlugin。
 * npm 包应使用默认导出（export default）导出一个 NanoPlugin 对象。
 *
 * 配置示例（.nano-code.yaml）：
 * ```yaml
 * plugins:
 *   my-helper:
 *     type: npm
 *     spec: "@scope/my-nano-plugin"
 * ```
 */
export const npmLoaderPlugin: NanoPlugin = {
  name: 'npm-loader',
  description: 'Load plugins from npm packages via dynamic import()',

  getTools(): ToolDefinition[] {
    return [];
  },

  async execute(_name: string, _args: any, _ctx: ToolContext): Promise<ToolResponse> {
    return { status: 'error', message: 'npm-loader provides no tools' };
  },

  async onInit(registry: PluginRegistry): Promise<void> {
    const npmEntries = registry.getPluginConfig('npm-loader') as Record<string, { spec?: string; enabled?: boolean }>;
    let loaded = 0;

    for (const [name, entry] of Object.entries(npmEntries)) {
      if (entry.enabled === false) continue;
      const spec = entry.spec;
      if (!spec) {
        console.warn(`[npm-loader] Plugin "${name}" has no "spec"，跳过。`);
        continue;
      }

      try {
        const mod = await import(spec);
        const plugin: NanoPlugin | undefined = mod.default || mod;
        if (!plugin || typeof plugin.name !== 'string' || typeof plugin.execute !== 'function') {
          console.warn(`[npm-loader] Package "${spec}" 没有导出有效的 NanoPlugin（需要 default export 包含 name 和 execute）。`);
          continue;
        }
        await registry.register(plugin);
        console.log(`[npm-loader] 已加载插件 "${plugin.name}" <- "${spec}"`);
        loaded++;
      } catch (err) {
        console.error(`[npm-loader] 加载插件 "${name}" 失败 ("${spec}"):`, err instanceof Error ? err.message : err);
      }
    }

    if (loaded > 0) {
      console.log(`[npm-loader] 本次共加载 ${loaded} 个 npm 插件。`);
    }
  },
};
