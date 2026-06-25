import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatToolResponse } from '../src/prompt.js';

describe('Environment Snapshot 环境快照注入测试', () => {
  test('error 状态的 response 会被自动追加 [System Environment Snapshot]', () => {
    const result = formatToolResponse({ status: 'error', message: 'test error' });
    const parsed = JSON.parse(result);
    assert.match(parsed.message || '', /\[System Environment Snapshot\]/);
  });

  test('rejected_by_user 状态的 response 会被自动追加 [System Environment Snapshot]', () => {
    const result = formatToolResponse({ status: 'rejected_by_user', message: 'rejected' });
    const parsed = JSON.parse(result);
    assert.match(parsed.message || '', /\[System Environment Snapshot\]/);
  });

  test('success 状态的 response 不会被追加 [System Environment Snapshot]', () => {
    const result = formatToolResponse({ status: 'success', data: 'ok' });
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.message, undefined);
  });

  test('newMessages 和 contextModifier 不会出现在序列化输出中', () => {
    const result = formatToolResponse({
      status: 'success',
      data: 'result',
      newMessages: [{ role: 'user', content: 'skill instruction' }],
      contextModifier: {},
    });
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.status, 'success');
    assert.strictEqual(parsed.data, 'result');
    assert.strictEqual(parsed.newMessages, undefined, 'newMessages 不应出现在 LLM 可见输出中');
    assert.strictEqual(parsed.contextModifier, undefined, 'contextModifier 不应出现在 LLM 可见输出中');
  });
});
