import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NanoCodeAgent } from '../src/agent.js';
import { PluginRegistry } from '../src/plugin.js';

/** Minimal mock that satisfies the LLMClient shape without calling the API. */
function mockLLM() {
  return {
    sendSystemMessage: async () => ({ text: 'mock response', stopReason: 'stop' }),
    getModel: () => 'gpt-4o',
  } as any;
}

describe('NanoCodeAgent — identity (getName)', () => {

  it('default name is main', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    assert.equal(agent.getName(), 'main');
  });

  it('custom name is returned by getName', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM(), undefined, undefined, 'dba');
    assert.equal(agent.getName(), 'dba');
  });

  it('runTask returns the last assistant content', async () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    const result = await agent.runTask('hello');
    assert.equal(result, 'mock response');
  });

  it('runTask returns undefined when no assistant message exists', async () => {
    const mock = {
      sendSystemMessage: async () => ({ text: null, stopReason: 'stop' }),
      getModel: () => 'gpt-4o',
    };
    const agent = new NanoCodeAgent(new PluginRegistry(), mock as any);
    const result = await agent.runTask('hello');
    assert.equal(result, undefined);
  });

});

describe('NanoCodeAgent — getHistory / loadHistory', () => {

  it('getHistory returns empty array for a fresh agent', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    assert.deepEqual(agent.getHistory(), []);
  });

  it('getHistory returns a copy (mutating the result does not affect internal state)', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    const h = agent.getHistory();
    h.push({ role: 'user', content: 'injected' });
    assert.equal(agent.getHistory().length, 0);
  });

  it('loadHistory replaces the internal history', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    const messages = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
    ];
    agent.loadHistory(messages);
    assert.equal(agent.getHistory().length, 2);
    assert.equal(agent.getHistory()[0].content, 'q1');
  });

  it('loadHistory does not share the array reference', () => {
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM());
    const messages = [{ role: 'user' as const, content: 'test' }];
    agent.loadHistory(messages);
    messages.push({ role: 'user' as const, content: 'appended' });
    assert.equal(agent.getHistory().length, 1);
  });

  it('agent stores constructor args correctly', () => {
    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent(registry, mockLLM(), 'custom-role');
    assert.deepEqual(agent.getHistory(), []);
  });

});

describe('NanoCodeAgent — lifecycle hooks', () => {

  it('calls onAgentTurnStart on runTask', async () => {
    const events: string[] = [];
    const display = {
      onAgentTurnStart(e: any) { events.push(`start:${e.agentName}`); },
      onAgentTurnEnd(e: any) { events.push(`end:${e.agentName}`); },
      onStateSnapshot(s: any) { events.push(`snapshot:${s.agentName}:${s.messageCount}`); },
      onStatus() {},
      onStreamChunk() {},
      onToolCall() {},
      onToolResult() {},
      onError() {},
    };
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM(), undefined, undefined, 'main', display as any);
    await agent.runTask('hello');
    assert.ok(events.some(e => e.startsWith('start:')), 'should have onAgentTurnStart');
    assert.ok(events.some(e => e.startsWith('end:')), 'should have onAgentTurnEnd');
    assert.ok(events.some(e => e.startsWith('snapshot:')), 'should have onStateSnapshot');
  });

  it('writes agent status to store on runTask', async () => {
    const registry = new PluginRegistry();
    let storeAgentState: any = null;
    // capture state after runTask completes
    const origSet = registry.store.set.bind(registry.store);
    registry.store.set = (key: string, value: any) => {
      origSet(key, value);
      if (key === 'agent') storeAgentState = registry.store.get('agent');
    };

    const agent = new NanoCodeAgent(registry, mockLLM(), undefined, undefined, 'store-test');
    await agent.runTask('hello');
    assert.ok(storeAgentState, 'should have set agent state');
    assert.equal(storeAgentState.agentName, 'store-test');
    assert.equal(storeAgentState.status, 'idle');
    assert.ok(typeof storeAgentState.messageCount === 'number');
  });

  it('passes correct agentName in lifecycle events', async () => {
    const events: string[] = [];
    const display = {
      onAgentTurnStart(e: any) { events.push(`start:${e.agentName}`); },
      onAgentTurnEnd(e: any) { events.push(`end:${e.agentName}`); },
      onStateSnapshot(s: any) { events.push(`snapshot:${s.agentName}`); },
      onStatus() {},
      onStreamChunk() {},
      onToolCall() {},
      onToolResult() {},
      onError() {},
    };
    const agent = new NanoCodeAgent(new PluginRegistry(), mockLLM(), undefined, undefined, 'my-agent', display as any);
    await agent.runTask('hello');
    assert.ok(events.some(e => e === 'start:my-agent'), 'agentName should be my-agent');
    assert.ok(events.some(e => e === 'end:my-agent'), 'agentName should be my-agent');
    assert.ok(events.some(e => e === 'snapshot:my-agent'), 'agentName should be my-agent');
  });

});

describe('NanoCodeAgent — malformed tool call JSON', () => {

  it('returns error to LLM when tool arguments are invalid JSON', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'test_tool', arguments: '{invalid json}' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent(registry, mock as any);
    await agent.runTask('do something');

    const history = agent.getHistory();
    // user msg + assistant(tool_calls) + tool(error) + assistant(done)
    assert.equal(history.length, 4);

    const toolError = history.find(m => m.role === 'tool');
    assert.ok(toolError, 'should have a tool error response');
    assert.ok(toolError!.content?.includes('不是合法的 JSON'), `content should mention invalid JSON`);
  });

  it('handles empty tool arguments string', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'test_tool', arguments: '' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent(registry, mock as any);
    await agent.runTask('do something');

    const history = agent.getHistory();
    assert.ok(history.length >= 2, 'should not crash on empty args');
    const toolError = history.find(m => m.role === 'tool');
    assert.ok(toolError, 'empty arguments should produce error response');
  });

  it('handles valid JSON arguments normally', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_3',
              type: 'function',
              function: { name: 'test_tool', arguments: '{"key": "value"}' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent(registry, mock as any);
    await agent.runTask('do something');

    const history = agent.getHistory();
    // Should still complete without crash
    const toolCalls = history.filter(m => m.role === 'tool');
    assert.ok(toolCalls.length > 0, 'should have tool responses');
  });

});
