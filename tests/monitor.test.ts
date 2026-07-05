import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { monitorPlugin, userConfirmation } from '../src/plugins/tools/monitor.js';

/**
 * Helper: execute monitor tool with given args.
 * Skips permission confirmation automatically.
 */
async function runMonitor(args: Record<string, any>, timeoutMs = 60_000): Promise<{ status: string; message?: string; data?: string }> {
  const ctx = {
    skipPermission: true,
    sideEffect: true,
    defaultTimeout: timeoutMs,
    outputHandler: null,
    confirmCallback: undefined,
  } as any;

  return await monitorPlugin.execute('monitor', args, ctx) as any;
}

describe('monitor tool — pattern matching', () => {

  it('matches a pattern in command output and returns early', async () => {
    const result = await runMonitor({
      command: 'echo "line1" && echo "line2" && echo "line3"',
      pattern: 'line2',
      timeout: 10_000,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.reason, 'match');
    assert.ok(data.matched);
    assert.ok(data.matchedLine!.includes('line2'));
    assert.ok(data.output.includes('line2'));
  });

  it('supports regex pattern matching', async () => {
    const result = await runMonitor({
      command: 'echo "INFO: started" && echo "WARNING: low disk" && echo "ERROR: crash"',
      pattern: 'ERROR',
      timeout: 10_000,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.reason, 'match');
    assert.ok(data.matched);
    assert.ok(data.matchedLine!.includes('ERROR'));
  });

  it('returns full output when no pattern provided (process exits)', async () => {
    const result = await runMonitor({
      command: 'echo "hello" && echo "world"',
      timeout: 10_000,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.reason, 'exit');
    assert.equal(data.matched, false);
    assert.ok(data.output.includes('hello'));
    assert.ok(data.output.includes('world'));
  });

  it('times out when pattern never matches', async () => {
    const result = await runMonitor({
      command: 'echo "waiting" && sleep 3 && echo "done"',
      pattern: 'NEVER_MATCH_THIS',
      timeout: 1_000,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.reason, 'timeout');
    assert.equal(data.matched, false);
    assert.ok(data.output.includes('waiting'));
  });

  it('truncates long output', async () => {
    const result = await runMonitor({
      command: 'for i in $(seq 1 1000); do echo "line-$i"; done',
      timeout: 10_000,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.ok(data.output.includes('[输出过长'));
  });

});

describe('monitor tool — security', () => {

  it('blocks dangerous commands via blacklist', async () => {
    const result = await runMonitor({
      command: 'rm -rf /some/dir',
    });

    assert.equal(result.status, 'error');
    assert.ok(result.message!.includes('安全拦截'));
  });

  it('blocks fork bombs', async () => {
    const result = await runMonitor({
      command: ':(){ :|:& };:',
    });

    assert.equal(result.status, 'error');
    assert.ok(result.message!.includes('安全拦截'));
  });

  it('allows safe commands', async () => {
    const result = await runMonitor({
      command: 'echo "safe command"',
      timeout: 5_000,
    });

    assert.equal(result.status, 'success');
  });

});

describe('monitor tool — error handling', () => {

  it('rejects missing command parameter', async () => {
    const result = await runMonitor({});
    assert.equal(result.status, 'error');
    assert.ok(result.message!.includes('缺少必填参数'));
  });

  it('handles non-existent commands gracefully', async () => {
    const result = await runMonitor({
      command: 'nonexistent_cmd_xyz',
      timeout: 5_000,
    });

    assert.equal(result.status, 'success'); // process exits with non-zero, but monitor captures output
    // Should not crash — the error should be captured in the output
  });

});
