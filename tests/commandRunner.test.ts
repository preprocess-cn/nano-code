import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { executeRunnerTool, userConfirmation } from '../src/plugins/tools/command.js';

describe('Command Runner 环境与执行测试', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('能够成功执行标准命令并捕获 stdout', async () => {
    mock.method(userConfirmation, 'ask', async () => true);
    const response = await executeRunnerTool('run_bash_command', { command: 'echo "hello nano-code"' });
    assert.strictEqual(response.status, 'success');
    assert.match(response.data || '', /hello nano-code/);
  });

  test('执行无效命令时能够捕获错误状态与退出码', async () => {
    mock.method(userConfirmation, 'ask', async () => true);
    const response = await executeRunnerTool('run_bash_command', { command: 'cat non_existent_file_safeguard.txt' });
    assert.strictEqual(response.status, 'error');
    assert.match(response.message || '', /Command failed with exit code/);
  });

  test('cd 到不存在的目录应返回错误', async () => {
    mock.method(userConfirmation, 'ask', async () => true);
    const response = await executeRunnerTool('run_bash_command', { command: 'cd directory_that_never_exists_12345' });
    assert.strictEqual(response.status, 'error');
  });

  test('输出超过 20KB 的极端巨量日志时，应自动截断中间部分', async () => {
    mock.method(userConfirmation, 'ask', async () => true);
    const longCommand = process.platform === 'win32'
      ? 'powershell -Command "Write-Output (\'A\' * 30000)"'
      : 'node -e "console.log(\'A\'.repeat(30000))"';
    const response = await executeRunnerTool('run_bash_command', { command: longCommand });
    assert.strictEqual(response.status, 'success');
    assert.ok((response.data || '').length < 25000, '截断机制失效，返回的日志体积过大！');
    assert.match(response.data || '', /系统已自动截断以节省 Context/);
  });
});
