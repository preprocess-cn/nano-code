import { test, describe } from 'vitest';
import assert from 'node:assert';
import { commandPlugin } from '../src/plugins/tools/command.js';

const NO_CONFIRM = { skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false };

describe('Command Runner 环境与执行测试', () => {

  test('能够成功执行标准命令并捕获 stdout', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "hello nano-code"' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /hello nano-code/);
  });

  test('执行无效命令时能够捕获错误状态与退出码', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'cat non_existent_file_safeguard.txt' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /Command failed with exit code/);
  });

  test('cd 到不存在的目录应返回错误', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'cd directory_that_never_exists_12345' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
  });

  test('输出超过 20KB 的极端巨量日志时，应自动截断中间部分', async () => {
    const longCommand = process.platform === 'win32'
      ? 'powershell -Command "Write-Output (\'A\' * 30000)"'
      : 'node -e "console.log(\'A\'.repeat(30000))"';
    const response = await commandPlugin.execute('run_bash_command', { command: longCommand }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.ok((response.data || '').length < 25000, '截断机制失效，返回的日志体积过大！');
    assert.match(response.data || '', /系统已自动截断以节省 Context/);
  });

  test('静默命令无输出时，应返回无输出提示', async () => {
    const silentCmd = process.platform === 'win32' ? 'ver > nul' : 'true';
    const response = await commandPlugin.execute('run_bash_command', { command: silentCmd }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /Command executed with no output/);
  });

  test('timeout 参数被接受且不影响快速命令', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo ok', timeout: 5000 }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /ok/);
  });

  test('timeout 参数较小时命令被 kill', { timeout: 5000 }, async () => {
    const start = Date.now();
    const response = await commandPlugin.execute('run_bash_command', { command: 'sleep 10', timeout: 200 }, NO_CONFIRM);
    const elapsed = Date.now() - start;
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /timed out/);
    assert.ok(elapsed < 5000, 'should timeout well before sleep completes');
  });

  test('context defaultTimeout 作为超时基准', async () => {
    const shortCtx = { ...NO_CONFIRM, defaultTimeout: 150 };
    const start = Date.now();
    const response = await commandPlugin.execute('run_bash_command', { command: 'sleep 10' }, shortCtx);
    const elapsed = Date.now() - start;
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /timed out/);
    assert.ok(elapsed < 3000, 'defaultTimeout should cause quick timeout');
  });

  test('timeout=0 不会导致崩溃，被下限保护', { timeout: 3000 }, async () => {
    // timeout=0 会被 Math.max(1, ...) 提升到 1ms，命令会被快速 kill
    const start = Date.now();
    const response = await commandPlugin.execute('run_bash_command', { command: 'sleep 10', timeout: 0 }, NO_CONFIRM);
    const elapsed = Date.now() - start;
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /timed out/);
    assert.ok(elapsed < 2000, 'should timeout very quickly');
  });

  test('timeout=-1 不会导致崩溃，被下限保护', { timeout: 3000 }, async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'sleep 10', timeout: -1 }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /timed out/);
  });

  // ── 退出码语义解释（exit 1 不总是错误） ──

  test('grep 未匹配 exit=1 返回 success', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'grep "__NO_MATCH_12345__" /dev/null' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /Exit code 1: No matches found/);
  });

  test('grep 正常匹配 exit=0 返回 success', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "hello" | grep "hello"' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /hello/);
  });

  test('grep 严重错误 exit=2 仍视为 error', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'grep pattern /nonexistent_file_xyz_123' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /Command failed with exit code/);
  });
});
