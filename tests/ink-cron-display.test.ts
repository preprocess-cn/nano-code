/**
 * Ink display — onStatus info level handling
 *
 * 验证 onStatus 的 info 级别映射正确性。
 * 导入 inkDisplayPlugin（闭包创建，不触发渲染），
 * 调用 onStatus({level:'info'}) 验证不抛异常。
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Ink display — onStatus info level', () => {
  it('accepts info level without error', async () => {
    const { inkDisplayPlugin } = await import('../src/plugins/display/claude-code-ink/index.js');
    assert.equal(typeof inkDisplayPlugin.onStatus, 'function');
    // 不会抛出异常
    inkDisplayPlugin.onStatus?.({ message: '* Running scheduled task (14:30:00)', agentName: 'main', level: 'info' });
    inkDisplayPlugin.onStatus?.({ message: '', agentName: 'main', level: 'info' });
  });
});
