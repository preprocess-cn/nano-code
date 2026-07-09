import { DisplayPlugin } from '#src/display.js';
import type { NanoConfig } from '#src/core/config.js';
import { replDisplay } from '#src/plugins/display/repl.js';
import { cliDisplay } from '#src/plugins/display/cli.js';

/**
 * 按配置解析并返回展示插件实例。
 *
 * - repl/cli 为内置实现
 * - 其他名称委托给 loader.ts
 *
 * 此函数在插件层，核心抽象（display.ts）无需知道具体展示实现。
 */
export async function initDisplay(config: NanoConfig): Promise<DisplayPlugin> {
  if (config.display?.enabled === false) {
    return config.display?.plugin
      ? (await loadCustomDisplay(config.display.plugin)) ?? cliDisplay
      : cliDisplay;
  }
  if (config.display?.plugin && config.display.plugin !== 'repl') {
    const plugin = await loadCustomDisplay(config.display.plugin);
    if (!plugin) {
      console.error(`Display plugin "${config.display.plugin}" not found`);
      process.exit(1);
    }
    return plugin;
  }
  return replDisplay;
}

async function loadCustomDisplay(spec: string): Promise<DisplayPlugin | null> {
  const { resolveDisplayPlugin: resolveExternal } = await import('#src/plugins/display/loader.js');
  return resolveExternal(spec);
}
