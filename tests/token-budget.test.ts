import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/plugin.js';
import { createTokenBudgetPlugin } from '../src/plugins/token-budget.js';
import { ChatMessage } from '../src/llm.js';

function makeMsgs(count: number, content = 'hello world '): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `${content} ${i}`,
  }));
}

describe('Token Budget Plugin', () => {
  it('passes messages through when under budget', () => {
    const plugin = createTokenBudgetPlugin({ maxTokensPerSession: 100000 });
    const msgs = makeMsgs(5);
    const result = plugin.onBeforeRequest!(msgs);
    assert.equal(result.length, msgs.length);
    assert.equal(result[0].content, msgs[0].content);
  });

  it('injects compression hint when accumulated usage exceeds threshold', () => {
    const plugin = createTokenBudgetPlugin({
      maxTokensPerSession: 100000,
      compressionThreshold: 10,
    });
    // Simulate accumulated usage over threshold
    plugin.onAfterRequest!({ text: 'x'.repeat(60), toolCalls: undefined });
    // ~20 tokens from text, > 10 threshold

    const msgs = makeMsgs(3, 'hi');
    const result = plugin.onBeforeRequest!(msgs);
    const last = result[result.length - 1];
    assert.match(last.content!, /简洁/);
  });

  it('injects hard stop when over session budget', () => {
    const plugin = createTokenBudgetPlugin({
      maxTokensPerSession: 10,
      compressionThreshold: 100,
    });
    plugin.onAfterRequest!({ text: 'x'.repeat(100), toolCalls: undefined });

    const msgs = makeMsgs(5, 'hello');
    const result = plugin.onBeforeRequest!(msgs);
    const last = result[result.length - 1];
    assert.match(last.content!, /token budget/);
  });

  it('rejects tool calls when over budget', () => {
    const plugin = createTokenBudgetPlugin({ maxTokensPerSession: 10 });
    plugin.onAfterRequest!({ text: 'x'.repeat(200), toolCalls: undefined });

    const result = plugin.onBeforeToolCall!({ id: '1', function: { name: 'test', arguments: '{}' } });
    assert.equal(result, null);
  });

  it('allows tool calls when under budget', () => {
    const plugin = createTokenBudgetPlugin({ maxTokensPerSession: 100000 });
    const result = plugin.onBeforeToolCall!({ id: '1', function: { name: 'test', arguments: '{}' } });
    assert.notEqual(result, null);
  });

  it('loads config from registry on init', async () => {
    const r = new PluginRegistry();
    // Set a very low session limit via registry config
    r.setPluginConfig('token-budget', {
      maxTokensPerSession: 30,
      compressionThreshold: 5,
    });

    const plugin = createTokenBudgetPlugin();
    await r.register(plugin);

    // Accumulate tokens past the new threshold (5)
    plugin.onAfterRequest!({ text: 'x'.repeat(30), toolCalls: undefined });

    const msgs = makeMsgs(2, 'hi');
    const result = plugin.onBeforeRequest!(msgs);
    const last = result[result.length - 1];
    assert.match(last.content!, /注意/);
  });

  it('uses exact token counts from rawMeta when available', () => {
    const plugin = createTokenBudgetPlugin({ maxTokensPerSession: 100000 });
    // Fallback: rawMeta empty, text-based estimation
    plugin.onAfterRequest!({ text: 'hello' });
    const beforeEst = plugin.onBeforeToolCall!({ id: '1', function: { name: 'test', arguments: '{}' } });
    assert.notEqual(beforeEst, null, 'should not reject yet');

    // Reset: inject exact token counts via rawMeta
    const plugin2 = createTokenBudgetPlugin({ maxTokensPerSession: 9 });
    plugin2.onAfterRequest!({ text: 'tiny' }, { promptTokens: 5, completionTokens: 5, totalTokens: 10 });

    // Over budget now
    const result = plugin2.onBeforeToolCall!({ id: '2', function: { name: 'test', arguments: '{}' } });
    assert.equal(result, null, 'should reject after rawMeta indicates budget exhausted');
  });

  it('can be registered as a NanoPlugin', async () => {
    const r = new PluginRegistry();
    const plugin = createTokenBudgetPlugin();
    await r.register(plugin);

    assert.equal(plugin.name, 'token-budget');
    assert.equal(r.getAllSchemas().length, 0);
  });
});
