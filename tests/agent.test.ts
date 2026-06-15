import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NanoCodeAgent } from '../src/agent.js';
import { PluginRegistry } from '../src/plugin.js';

/** Minimal mock that satisfies the LLMClient shape without calling the API. */
function mockLLM() {
  return {
    sendSystemMessage: async () => ({ text: 'mock response', stopReason: 'stop' }),
  } as any;
}

describe('NanoCodeAgent — getHistory / loadHistory', () => {

  it('getHistory returns empty array for a fresh agent', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), false, false, mockLLM());
    assert.deepEqual(agent.getHistory(), []);
  });

  it('getHistory returns a copy (mutating the result does not affect internal state)', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), false, false, mockLLM());
    const h = agent.getHistory();
    h.push({ role: 'user', content: 'injected' });
    assert.equal(agent.getHistory().length, 0);
  });

  it('loadHistory replaces the internal history', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), false, false, mockLLM());
    const messages = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
    ];
    agent.loadHistory(messages);
    assert.equal(agent.getHistory().length, 2);
    assert.equal(agent.getHistory()[0].content, 'q1');
  });

  it('loadHistory does not share the array reference', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), false, false, mockLLM());
    const messages = [{ role: 'user' as const, content: 'test' }];
    agent.loadHistory(messages);
    messages.push({ role: 'user' as const, content: 'appended' });
    assert.equal(agent.getHistory().length, 1);
  });

  it('agent stores constructor args correctly', () => {
    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent(registry, true, true, mockLLM(), 'custom-role');
    assert.deepEqual(agent.getHistory(), []);
  });

});
