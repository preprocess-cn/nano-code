import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DisplayPlugin } from '#src/display.js';

const DISPLAY_DIR = path.join(os.homedir(), '.nano-code', 'presentations');

/**
 * 按名称或路径加载展示插件。
 * "repl" → 返回 null（调用方使用默认）。
 * 路径 → import 该文件。
 * 名称 → 搜索 ~/.nano-code/presentations/<name>.{js,mjs}。
 */
export async function resolveDisplayPlugin(spec: string): Promise<DisplayPlugin | null> {
  if (spec === 'repl') return null;

  // Built-in ink display plugin
  if (spec === 'claude-code-ink') {
    try {
      const { inkDisplayPlugin } = await import('#src/plugins/display/claude-code-ink/index.js');
      return inkDisplayPlugin;
    } catch (err: any) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('Cannot find package')) {
        throw new Error(
          'Ink 展示插件加载失败：缺少可选依赖。请运行 "npm install"（缺省安装）或 "npm run install:default" 来安装 TUI 依赖。'
        );
      }
      throw new Error(`加载 Ink 展示插件失败: ${err.message}`);
    }
  }

  let resolvedPath: string | null = null;

  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    resolvedPath = path.resolve(spec);
  } else {
    if (fs.existsSync(DISPLAY_DIR)) {
      for (const ext of ['.js', '.mjs']) {
        const candidate = path.join(DISPLAY_DIR, `${spec}${ext}`);
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
    }
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error(`展示插件 "${spec}" 未找到（已检查路径和 ~/.nano-code/presentations/）`);
  }

  try {
    const mod = await import(resolvedPath);
    const plugin: any = (mod as any).default || mod;
    if (!plugin || typeof plugin.name !== 'string') {
      throw new Error(`"${resolvedPath}" 未导出有效的展示插件（需要 default export 或导出含 name 字段的对象）`);
    }
    return plugin as DisplayPlugin;
  } catch (err: any) {
    throw new Error(`加载展示插件 "${spec}" 失败: ${err.message}`);
  }
}
