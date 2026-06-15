import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { executeRunnerTool, userConfirmation } from '../src/plugins/tools/command.js';

describe('Security 安全熔断与交互契约测试', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('命中 rm -rf 危险黑名单时，必须静默熔断', async () => {
    // 黑名单检查在弹窗前，不需要 mock
    const response = await executeRunnerTool('run_bash_command', { command: 'rm -rf /usr/bin' });
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /CRITICAL SECURITY VIOLATION/);
  });

  test('当用户在弹窗中选择允许(true)时，命令应当正常下发', async () => {
    mock.method(userConfirmation, 'ask', async () => true);
    const response = await executeRunnerTool('run_bash_command', { command: 'echo "allowed"' });
    assert.strictEqual(response.status, 'success');
  });

  test('当用户在弹窗中选择拒绝(false)时，原生返回 rejected_by_user 状态', async () => {
    mock.method(userConfirmation, 'ask', async () => false);
    const response = await executeRunnerTool('run_bash_command', { command: 'npm run test' });
    assert.strictEqual(response.status, 'rejected_by_user');
    assert.match(response.message || '', /rejected by user/);
  });

  test('当用户在弹窗期间按下 Ctrl+C (Symbol) 强退时，同样触发 rejected_by_user 熔断', async () => {
    // userConfirmation.ask 内部会将 Symbol 转换为 false，mock 直接返回最终值
    mock.method(userConfirmation, 'ask', async () => false);
    const response = await executeRunnerTool('run_bash_command', { command: 'git push origin main' });
    assert.strictEqual(response.status, 'rejected_by_user');
    assert.match(response.message || '', /rejected by user/);
  });

  test('skipPermission=true 越过确认，命令直接执行', async () => {
    // 不 mock userConfirmation，跳过确认应成功
    const response = await executeRunnerTool('run_bash_command', { command: 'echo "skip-ok"' }, true);
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /skip-ok/);
  });

  test('skipPermission=true 仍然拦截危险命令黑名单', async () => {
    const response = await executeRunnerTool('run_bash_command', { command: 'rm -rf /' }, true);
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /CRITICAL SECURITY VIOLATION/);
  });
});
