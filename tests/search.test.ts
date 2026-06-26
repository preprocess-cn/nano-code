import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { searchPlugin } from '../src/plugins/tools/search.js';

const CTX = { skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false };

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nano-code-search-test-'));
}

function removeTempDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('glob_files 文件搜索功能', () => {
  let tmpDir: string;
  const origCwd = process.cwd;

  beforeEach(() => {
    tmpDir = createTempDir();
    // 创建测试文件结构
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/utils'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'node_modules/package'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src/index.ts'), 'export const a = 1;', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src/utils/helper.ts'), 'export const b = 2;', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src/utils/parser.js'), 'module.exports = {};', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'tests/index.test.ts'), 'import assert from "assert";', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello', 'utf8');
    // node_modules 里的文件不应出现在搜索结果中
    fs.writeFileSync(path.join(tmpDir, 'node_modules/package/index.ts'), 'export const x = 1;', 'utf8');
    // dist 目录也应被忽略
    fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'dist/bundle.js'), 'console.log("bundled");', 'utf8');
    // 临时修改 cwd
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    removeTempDir(tmpDir);
  });

  test('glob **/*.ts 递归搜索所有 TypeScript 文件', async () => {
    const res = await searchPlugin.execute('glob_files', { pattern: '**/*.ts' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('src/index.ts'));
    assert.ok(data.includes('src/utils/helper.ts'));
    assert.ok(data.includes('tests/index.test.ts'));
    // 不包含 node_modules 和 dist 中的文件
    assert.ok(!data.includes('node_modules'));
    assert.ok(!data.includes('dist'));
  });

  test('glob src/**/*.ts 限定目录搜索', async () => {
    const res = await searchPlugin.execute('glob_files', { pattern: 'src/**/*.ts' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('src/index.ts'));
    assert.ok(data.includes('src/utils/helper.ts'));
    assert.ok(!data.includes('tests/index.test.ts'));
  });

  test('glob *.json 根目录搜索', async () => {
    const res = await searchPlugin.execute('glob_files', { pattern: '*.json' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('package.json'));
  });

  test('glob 无匹配返回提示信息', async () => {
    const res = await searchPlugin.execute('glob_files', { pattern: '*.rb' }, CTX);
    assert.strictEqual(res.status, 'success');
    assert.ok((res.data as string).includes('No files matched'));
  });

  test('glob 缺少 pattern 返回错误', async () => {
    const res = await searchPlugin.execute('glob_files', {}, CTX);
    assert.strictEqual(res.status, 'error');
  });

  test('glob ignore 参数排除额外目录', async () => {
    fs.mkdirSync(path.join(tmpDir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'build/output.js'), '// built', 'utf8');
    const res = await searchPlugin.execute('glob_files', { pattern: '**/*.js', ignore: 'build' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('src/utils/parser.js'));
    assert.ok(!data.includes('build'));
  });

  test('glob 不存在的目录返回空', async () => {
    const res = await searchPlugin.execute('glob_files', { pattern: 'nonexistent/**/*.ts' }, CTX);
    assert.strictEqual(res.status, 'success');
    assert.ok((res.data as string).includes('No files matched'));
  });
});

describe('grep_file_content 内容搜索功能', () => {
  let tmpDir: string;
  const origCwd = process.cwd;

  beforeEach(() => {
    tmpDir = createTempDir();
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/index.ts'), [
      'import { something } from "./utils";',
      '',
      'function greet(name: string) {',
      '  return `Hello, ${name}!`;',
      '}',
      '',
      'export default greet;',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src/utils.ts'), [
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '',
      'export const VERSION = "1.0.0";',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# My Project\n\nThis is a test project.', 'utf8');
    // node_modules 不应被搜索
    fs.writeFileSync(path.join(tmpDir, 'node_modules/secret.txt'), 'SENSITIVE=12345', 'utf8');
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    removeTempDir(tmpDir);
  });

  test('基本字符串搜索', async () => {
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'greet' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('src/index.ts'));
    assert.ok(data.includes('function greet'));
  });

  test('正则搜索', async () => {
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'export\\s+(default|const|function)' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('src/index.ts'));
    assert.ok(data.includes('src/utils.ts'));
    assert.ok(data.includes('export default'));
    assert.ok(data.includes('export const'));
    assert.ok(data.includes('export function'));
  });

  test('大小写不敏感搜索', async () => {
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'HELLO' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    assert.ok(data.includes('Hello'));
  });

  test('无匹配返回提示信息', async () => {
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'qwertyuiop123456' }, CTX);
    assert.strictEqual(res.status, 'success');
    assert.ok((res.data as string).includes('No matches found'));
  });

  test('glob 参数限制搜索范围', async () => {
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'export', glob: 'src/**/*.ts' }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    // src 下的 ts 文件应有匹配
    assert.ok(data.includes('src/index.ts') || data.includes('src/utils.ts'));
    // README.md 不应出现（不在 glob 范围内）
    assert.ok(!data.includes('README.md'));
  });

  test('maxResults 限制返回条数', async () => {
    // README.md 中也有 "is" (This is a test...)
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'return', maxResults: 1 }, CTX);
    assert.strictEqual(res.status, 'success');
    const data = res.data as string;
    const lines = data.split('\n').filter(l => l.includes(':'));
    assert.ok(lines.length <= 2); // 首行是 summary，后面是匹配行
  });

  test('缺少 pattern 返回错误', async () => {
    const res = await searchPlugin.execute('grep_file_content', {}, CTX);
    assert.strictEqual(res.status, 'error');
  });

  test('自动跳过二进制文件', async () => {
    const binFile = path.join(tmpDir, 'data.bin');
    fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    const res = await searchPlugin.execute('grep_file_content', { pattern: 'test' }, CTX);
    assert.strictEqual(res.status, 'success');
    // 不应报错
    assert.ok(res.data);
  });
});
