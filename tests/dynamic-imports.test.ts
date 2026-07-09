import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 运行时动态 import('#src/...') 在 tsx [eval] 上下文中会走 CJS fallback，
 * 导致 MODULE_NOT_FOUND。此测试确保所有非必要动态 #src import 已被清理。
 *
 * 保留（必要）：
 * - src/core/plugin.ts BUILTIN_LOADERS — 延迟加载插件
 * - src/plugins/token-budget/index.ts — CompactService 按需加载
 * - src/plugins/commands/skills-slash.ts — 循环依赖规避
 * - src/plugins/skills/index.ts — 循环依赖规避
 * - src/plugins/display/* — 可选依赖加载（含 src/index.ts 中的 Ink bridge）
 * - src/plugin-cli.ts — CLI 一次性命令
 */
function isAllowed(sourceFile: string, importTarget: string): boolean {
  const sourceRelative = sourceFile.replace(/\\/g, '/');

  // 按源文件路径匹配
  const allowedSourceFiles = [
    'src/core/plugin.ts',                    // BUILTIN_LOADERS
    'src/plugins/token-budget/index.ts',     // CompactService 按需加载
    'src/plugins/commands/skills-slash.ts',  // 循环依赖规避
    'src/plugins/skills/index.ts',           // 循环依赖规避
    'src/plugin-cli.ts',                     // CLI 一次性命令
  ];
  if (allowedSourceFiles.some(p => sourceRelative.startsWith(p))) return true;

  // 源文件在 display 目录下的全部允许（可选依赖）
  if (sourceRelative.startsWith('src/plugins/display/')) return true;

  // 导入目标是 display 相关路径的全部允许
  if (importTarget.startsWith('#src/plugins/display/')) return true;

  return false;
}

it('no unexpected dynamic import(#src/...) in source files', () => {
  const root = path.resolve(__dirname, '..');
  const srcDir = path.join(root, 'src');

  const violations: string[] = [];

  function scanDir(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const relativePath = path.relative(root, fullPath);

        const content = fs.readFileSync(fullPath, 'utf-8');
        // 匹配运行时动态 await import('#src/...')（排除 type-only 的 import() 类型标注）
        const matches = content.match(/await\s+import\('#src\/[^']+'\)/g);
        if (matches) {
          for (const match of matches) {
            const target = match.match(/import\('([^']+)'\)/)?.[1] || '';
            if (!isAllowed(relativePath, target)) {
              violations.push(`${relativePath}: ${match}`);
            }
          }
        }
      }
    }
  }

  scanDir(srcDir);

  if (violations.length > 0) {
    assert.fail(
      `发现 ${violations.length} 个非预期的动态 #src import，` +
      `在 tsx [eval] 上下文中可能导致 MODULE_NOT_FOUND：\n` +
      violations.join('\n')
    );
  }
});

it('core files must not directly import plugin modules', () => {
  const root = path.resolve(__dirname, '..');

  // 允许直接 import 插件的文件（非核心层）
  const allowedFiles = new Set([
    'src/display.ts',
    'src/index.ts',
    'src/plugin-cli.ts',
  ]);

  const violations: string[] = [];

  function checkFile(filePath: string, relativePath: string) {
    if (allowedFiles.has(relativePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过动态 import（BUILTIN_LOADERS 中的懒加载）
      if (/await\s+import\s*\(/.test(line)) continue;
      // 跳过 type-only import（编译时擦除，无运行时依赖）
      if (/^import\s+type\s/.test(line.trim())) continue;

      // 检查静态 import from '#src/plugins/...'
      if (/from\s+(['"])#src\/plugins\/[^'"]+\1/.test(line)) {
        violations.push(`${relativePath}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  // 检查 src/index.ts
  checkFile(path.join(root, 'src', 'index.ts'), 'src/index.ts');

  // 检查 src/core/ 下所有 .ts 文件
  const coreDir = path.join(root, 'src', 'core');
  function scanDir(dir: string, baseRelative: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = baseRelative + '/' + entry.name;
      if (entry.isDirectory()) {
        scanDir(fullPath, relativePath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        checkFile(fullPath, relativePath);
      }
    }
  }
  scanDir(coreDir, 'src/core');

  if (violations.length > 0) {
    assert.fail(
      `发现 ${violations.length} 处核心文件直接 import 了插件代码，` +
      `核心层（src/index.ts + src/core/）不应直接引用插件模块：\n` +
      violations.join('\n')
    );
  }
});
