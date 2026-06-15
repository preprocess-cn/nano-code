import { test, describe, mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { fsPlugin, patchConfirmation } from '../src/plugins/tools/fs.js';

const CTX_CONFIRM = { skipPermission: false, cwd: process.cwd(), defaultTimeout: 30000 };
const CTX_SKIP = { skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000 };

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nano-code-test-'));
}

function removeTempDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('filePatcher 修补文件功能测试', () => {
  let tmpDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    testFilePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(testFilePath, 'line one\nline two\nline three\n', 'utf8');
    mock.method(patchConfirmation, 'ask', async () => true);
  });

  afterEach(() => {
    mock.restoreAll();
    removeTempDir(tmpDir);
  });

  test('基础成功场景：精确替换文件中的代码块', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'line two',
      replace: 'line modified'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /File patched successfully/);

    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'line one\nline modified\nline three\n');
  });

  test('替换多行代码块', async () => {
    fs.writeFileSync(testFilePath, 'function foo() {\n  return 1;\n}\n', 'utf8');

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: '  return 1;',
      replace: '  return 42;'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'success');
    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'function foo() {\n  return 42;\n}\n');
  });

  test('search 字符串不存在于文件中时返回 error', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'does not exist in file',
      replace: 'irrelevant'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /search.*not found/i);
  });

  test('文件不存在时返回 error', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: path.join(tmpDir, 'nonexistent.txt'),
      search: 'anything',
      replace: 'nothing'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /does not exist/i);
  });

  test('缺少 path 参数时返回 error', async () => {
    const response = await fsPlugin.execute('patch_file', {
      search: 'foo',
      replace: 'bar'
    }, CTX_SKIP);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /missing required parameters/i);
  });

  test('缺少 search 参数时返回 error', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      replace: 'bar'
    }, CTX_SKIP);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /missing required parameters/i);
  });

  test('缺少 replace 参数时返回 error', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'foo'
    }, CTX_SKIP);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /missing required parameters/i);
  });

  test('search 为空字符串时返回 error（防止误匹配所有文件）', async () => {
    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: '',
      replace: 'prepended'
    }, CTX_SKIP);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /must not be empty/i);
  });

  test('search 在文件中出现多次时，仅替换第一个匹配', async () => {
    fs.writeFileSync(testFilePath, 'aaa bbb aaa bbb\n', 'utf8');

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'aaa',
      replace: 'xxx'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'success');
    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'xxx bbb aaa bbb\n');
  });

  test('缩进/大小写敏感匹配：不会替换大小写不同的内容', async () => {
    fs.writeFileSync(testFilePath, 'Hello World\n', 'utf8');

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'hello world',
      replace: 'replaced'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /not found/i);
  });

  test('用户拒绝修改时返回 rejected_by_user', async () => {
    mock.method(patchConfirmation, 'ask', async () => false);

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'line two',
      replace: 'line modified'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'rejected_by_user');
    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'line one\nline two\nline three\n');
  });

  test('skipPermission=true 越过确认，直接修补文件', async () => {
    mock.restoreAll(); // 移除 beforeEach 中的 mock，验证不打 confirm 也能通过

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'line two',
      replace: 'line skipped'
    }, CTX_SKIP);

    assert.strictEqual(response.status, 'success');
    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'line one\nline skipped\nline three\n');
  });

  test('skipPermission=false 且用户拒绝时返回 rejected_by_user', async () => {
    mock.method(patchConfirmation, 'ask', async () => false);

    const response = await fsPlugin.execute('patch_file', {
      path: testFilePath,
      search: 'line two',
      replace: 'should not happen'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'rejected_by_user');
    const content = fs.readFileSync(testFilePath, 'utf8');
    assert.strictEqual(content, 'line one\nline two\nline three\n');
  });

  test('path 为绝对路径时也能正确处理', async () => {
    const absPath = path.resolve(tmpDir, 'sub/deep/test.txt');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, 'original content\n', 'utf8');

    const response = await fsPlugin.execute('patch_file', {
      path: absPath,
      search: 'original content',
      replace: 'patched content'
    }, CTX_CONFIRM);

    assert.strictEqual(response.status, 'success');
    assert.strictEqual(fs.readFileSync(absPath, 'utf8'), 'patched content\n');
  });
});
