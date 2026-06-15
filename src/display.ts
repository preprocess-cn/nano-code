import { PluginRegistry } from './plugin.js';

/**
 * Pretty-print every registered plugin and its tools to stdout.
 */
export function printPluginList(registry: PluginRegistry): void {
  const plugins = registry.listPlugins();
  if (plugins.length === 0) {
    console.log('\n  当前没有注册任何插件。\n');
    return;
  }

  console.log(`\n  已注册插件 (${plugins.length}):\n`);
  for (const p of plugins) {
    const tag = p.name.startsWith('mcp:') ? 'MCP' : '内置';
    console.log(`  ${p.name} [${tag}]`);
    if (p.description) {
      console.log(`   〉${p.description}`);
    }
    const tools = p.tools;
    if (tools.length > 0) {
      for (const t of tools) {
        const desc = t.function.description.replace(/\n.*/s, '').slice(0, 80);
        console.log(`    • ${t.function.name.padEnd(22)} ${desc}`);
      }
    } else {
      console.log(`    (无工具 — 仅挂载钩子)`);
    }
    console.log('');
  }
}
