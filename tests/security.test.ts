import { test, describe, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import { commandPlugin, userConfirmation } from '../src/plugins/tools/command.js';

const NO_CONFIRM = { skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: true };
const WITH_CONFIRM = { skipPermission: false, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: true };
const NO_SIDE_EFFECT = { skipPermission: false, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false };

describe('Security 安全熔断与交互契约测试', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('命中 rm -rf 危险黑名单时，必须静默熔断', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'rm -rf /usr/bin' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /CRITICAL SECURITY VIOLATION/);
  });

  test('当用户在弹窗中选择允许(true)时，命令应当正常下发', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => true);
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "allowed"' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'success');
  });

  test('当用户在弹窗中选择拒绝(false)时，原生返回 rejected_by_user 状态', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => false);
    const response = await commandPlugin.execute('run_bash_command', { command: 'npm run test' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'rejected_by_user');
    assert.match(response.message || '', /rejected by user/);
  });

  test('当用户在弹窗期间按下 Ctrl+C (Symbol) 强退时，同样触发 rejected_by_user 熔断', async () => {
    // userConfirmation.ask 内部会将 Symbol 转换为 false，mock 直接返回最终值
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => false);
    const response = await commandPlugin.execute('run_bash_command', { command: 'git push origin main' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'rejected_by_user');
    assert.match(response.message || '', /rejected by user/);
  });

  test('skipPermission=true 越过确认，命令直接执行', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "skip-ok"' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /skip-ok/);
  });

  test('skipPermission=true 仍然拦截危险命令黑名单', async () => {
    const response = await commandPlugin.execute('run_bash_command', { command: 'rm -rf /' }, NO_CONFIRM);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /CRITICAL SECURITY VIOLATION/);
  });

  test('sideEffect=false 时，即使 skipPermission=false 也不弹确认直接执行', async () => {
    // 如果 sideEffect=false，userConfirmation.ask 不会被调用
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => { throw new Error('should not be called'); });
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "no-side-effect"' }, NO_SIDE_EFFECT);
    assert.strictEqual(response.status, 'success');
  });

  // ── 只读命令检测 ──

  test('只读命令（echo）跳过权限确认，不弹窗', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => { throw new Error('should not be called for readonly command'); });
    const response = await commandPlugin.execute('run_bash_command', { command: 'echo "readonly-test"' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /readonly-test/);
  });

  test('只读命令（cat）跳过权限确认', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => { throw new Error('should not be called for readonly command'); });
    const response = await commandPlugin.execute('run_bash_command', { command: 'cat /dev/null' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'success');
  });

  test('只读命令（ls）跳过权限确认', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => { throw new Error('should not be called for readonly command'); });
    const response = await commandPlugin.execute('run_bash_command', { command: 'ls /tmp' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'success');
  });

  test('写入命令（touch）仍然触发权限确认', async () => {
    // mock 返回 true（用户批准），验证执行不会抛错
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => true);
    const response = await commandPlugin.execute('run_bash_command', { command: 'touch /tmp/nano-code-test-write-flag' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'success');
  });

  test('写入命令被用户拒绝时返回 rejected_by_user', async () => {
    vi.spyOn(userConfirmation, 'ask').mockImplementation( async () => false);
    const response = await commandPlugin.execute('run_bash_command', { command: 'rm /tmp/nonexistent' }, WITH_CONFIRM);
    assert.strictEqual(response.status, 'rejected_by_user');
  });
});
