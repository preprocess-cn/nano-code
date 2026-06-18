import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DisplayPlugin } from '../../display.js';

const DISPLAY_DIR = path.join(os.homedir(), '.nano-code', 'presentations');

/**
 * 按名称或路径加载展示插件。
 * "repl" → 返回 null（调用方使用默认）。
 * 路径 → import 该文件。
 * 名称 → 搜索 ~/.nano-code/presentations/<name>.{js,mjs}。
 */
export async function resolveDisplayPlugin(spec: string): Promise<DisplayPlugin | null> {
  if (spec === 'repl') return null;

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
