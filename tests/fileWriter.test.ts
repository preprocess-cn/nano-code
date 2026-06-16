import { test, describe, mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fsPlugin, writerConfirmation } from '../src/plugins/tools/fs.js';

const TEST_DIR = '_nano_test_temp';
const NO_CONFIRM = { skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: true };
const WITH_CONFIRM = { skipPermission: false, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: true };
const NO_SIDE_EFFECT = { skipPermission: false, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false };

describe('fileWriter 文件写入功能测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), TEST_DIR, `fw-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    mock.restoreAll();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('skipPermission=true 时越过确认，直接写入文件', async () => {
    const filePath = path.relative(process.cwd(), path.join(tmpDir, 'hello.txt'));
    const response = await fsPlugin.execute('write_file_content', {
      path: filePath,
      content: 'skip-permission test'
    }, NO_CONFIRM);

    assert.strictEqual(response.status, 'success');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf8'), 'skip-permission test');
  });

  test('skipPermission=false 且用户拒绝时返回 rejected_by_user', async () => {
    mock.method(writerConfirmation, 'ask', async () => false);

    const filePath = path.relative(process.cwd(), path.join(tmpDir, 'secret.txt'));
    const response = await fsPlugin.execute('write_file_content', {
      path: filePath,
      content: 'should not appear'
    }, WITH_CONFIRM);

    assert.strictEqual(response.status, 'rejected_by_user');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'secret.txt')));
  });

  test('skipPermission=false 且用户批准时写入成功', async () => {
    mock.method(writerConfirmation, 'ask', async () => true);

    const filePath = path.relative(process.cwd(), path.join(tmpDir, 'approved.txt'));
    const response = await fsPlugin.execute('write_file_content', {
      path: filePath,
      content: 'user approved'
    }, WITH_CONFIRM);

    assert.strictEqual(response.status, 'success');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'approved.txt'), 'utf8'), 'user approved');
  });

  test('skipPermission=true 仍然拦截目录穿越', async () => {
    const response = await fsPlugin.execute('write_file_content', {
      path: '../../etc/passwd',
      content: 'hack'
    }, NO_CONFIRM);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /安全拒绝/);
  });

  test('缺少 path 参数时返回 error', async () => {
    const response = await fsPlugin.execute('write_file_content', {
      content: 'data'
    }, NO_CONFIRM);

    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /missing required/i);
  });

  test('sideEffect=false 跳过确认直接写入', async () => {
    // sideEffect=false 时 writerConfirmation.ask 不应被调用
    mock.method(writerConfirmation, 'ask', async () => { throw new Error('should not be called'); });
    const filePath = path.relative(process.cwd(), path.join(tmpDir, 'no-se.txt'));
    const response = await fsPlugin.execute('write_file_content', {
      path: filePath,
      content: 'auto-write'
    }, NO_SIDE_EFFECT);

    assert.strictEqual(response.status, 'success');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'no-se.txt'), 'utf8'), 'auto-write');
  });
});
