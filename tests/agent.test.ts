import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NanoCodeAgent } from '../src/core/agent.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { SK } from '../src/core/store-keys.js';

/** Minimal mock that satisfies the LLMClient shape without calling the API. */
function mockLLM() {
  return {
    sendSystemMessage: async () => ({ text: 'mock response', stopReason: 'stop' }),
    getModel: () => 'gpt-4o',
  } as any;
}

describe('NanoCodeAgent — identity (getName)', () => {

  it('default name is main', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    assert.equal(agent.getName(), 'main');
  });

  it('custom name is returned by getName', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM(), name: 'dba' });
    assert.equal(agent.getName(), 'dba');
  });

  it('runTask returns the last assistant content', async () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    const result = await agent.runTask('hello');
    assert.equal(result, 'mock response');
  });

  it('runTask returns undefined when no assistant message exists', async () => {
    const mock = {
      sendSystemMessage: async () => ({ text: null, stopReason: 'stop' }),
      getModel: () => 'gpt-4o',
    };
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mock as any });
    const result = await agent.runTask('hello');
    assert.equal(result, undefined);
  });

});

describe('NanoCodeAgent — getHistory / loadHistory', () => {

  it('getHistory returns empty array for a fresh agent', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    assert.deepEqual(agent.getHistory(), []);
  });

  it('getHistory returns a copy (mutating the result does not affect internal state)', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    const h = agent.getHistory();
    h.push({ role: 'user', content: 'injected' });
    assert.equal(agent.getHistory().length, 0);
  });

  it('loadHistory replaces the internal history', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    const messages = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
    ];
    agent.loadHistory(messages);
    assert.equal(agent.getHistory().length, 2);
    assert.equal(agent.getHistory()[0].content, 'q1');
  });

  it('loadHistory does not share the array reference', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    const messages = [{ role: 'user' as const, content: 'test' }];
    agent.loadHistory(messages);
    messages.push({ role: 'user' as const, content: 'appended' });
    assert.equal(agent.getHistory().length, 1);
  });

  it('agent stores constructor args correctly', () => {
    const registry = new PluginRegistry();
    const agent = new NanoCodeAgent({ registry: registry, llmClient: mockLLM(), agentRole: 'custom-role' });
    assert.deepEqual(agent.getHistory(), []);
  });

  it('getAgentRole returns the role passed to constructor', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM(), agentRole: 'test-role' });
    assert.equal(agent.getAgentRole(), 'test-role');
  });

  it('getAgentRole returns undefined when no role was set', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    assert.equal(agent.getAgentRole(), undefined);
  });

});

describe('NanoCodeAgent — setRole', () => {

  it('setRole updates the agent role', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    agent.setRole('new-role');
    assert.equal(agent.getAgentRole(), 'new-role');
  });

  it('setRole with role and promptConfig', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    const config = { withTools: 'custom {tool_list} tools', noTools: 'custom no tools' };
    agent.setRole('expert', config);
    assert.equal(agent.getAgentRole(), 'expert');
  });

  it('setRole with undefined clears the role', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM(), agentRole: 'old-role' });
    assert.equal(agent.getAgentRole(), 'old-role');
    agent.setRole(undefined, undefined);
    assert.equal(agent.getAgentRole(), undefined);
  });

  it('setRole replaces previous role', () => {
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
    agent.setRole('first');
    agent.setRole('second');
    assert.equal(agent.getAgentRole(), 'second');
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
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM(), name: 'main', display: display as any });
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

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mockLLM(), name: 'store-test' });
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
    const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM(), name: 'my-agent', display: display as any });
    await agent.runTask('hello');
    assert.ok(events.some(e => e === 'start:my-agent'), 'agentName should be my-agent');
    assert.ok(events.some(e => e === 'end:my-agent'), 'agentName should be my-agent');
    assert.ok(events.some(e => e === 'snapshot:my-agent'), 'agentName should be my-agent');
  });

});

function toolCallingMock(toolCallId: string, toolName: string, args: string) {
  let callCount = 0;
  return {
    sendSystemMessage: async () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: null,
          toolCalls: [{ id: toolCallId, type: 'function', function: { name: toolName, arguments: args } }],
          stopReason: 'tool_use',
        };
      }
      return { text: 'done', stopReason: 'stop' };
    },
    getModel: () => 'gpt-4o',
  };
}

describe('NanoCodeAgent — display events carry tool_call_id', () => {

  it('onToolCall / onToolResult 都携带正确的 id', async () => {
    const calls: any[] = [];
    const results: any[] = [];
    const display = {
      onAgentTurnStart() {},
      onAgentTurnEnd() {},
      onStateSnapshot() {},
      onStatus() {},
      onStreamChunk() {},
      onError() {},
      onToolCall(e: any) { calls.push(e); },
      onToolResult(e: any) { results.push(e); },
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'test',
      getTools: () => [{
        type: 'function',
        function: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({ status: 'success' as const, data: 'ok' }),
    });

    const agent = new NanoCodeAgent({
      registry,
      llmClient: toolCallingMock('call_dsp_001', 'echo', '{"x":1}') as any,
      display: display as any,
    });
    await agent.runTask('run echo');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'call_dsp_001');
    assert.equal(calls[0].toolName, 'echo');

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'call_dsp_001');
    assert.equal(results[0].status, 'success');
  });

  it('工具执行失败时 onToolResult 仍携带 id', async () => {
    const results: any[] = [];
    const display = {
      onAgentTurnStart() {},
      onAgentTurnEnd() {},
      onStateSnapshot() {},
      onStatus() {},
      onStreamChunk() {},
      onError() {},
      onToolCall() {},
      onToolResult(e: any) { results.push(e); },
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'fail',
      getTools: () => [{
        type: 'function',
        function: { name: 'crash', description: 'crash', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => { throw new Error('boom'); },
    });

    const agent = new NanoCodeAgent({
      registry,
      llmClient: toolCallingMock('call_dsp_002', 'crash', '{}') as any,
      display: display as any,
    });
    await agent.runTask('run crash');

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'call_dsp_002');
    assert.equal(results[0].status, 'error');
  });

  it('用户拒绝时 onToolResult 仍携带 id', async () => {
    const results: any[] = [];
    const display = {
      onAgentTurnStart() {},
      onAgentTurnEnd() {},
      onStateSnapshot() {},
      onStatus() {},
      onStreamChunk() {},
      onError() {},
      onToolCall() {},
      onToolResult(e: any) { results.push(e); },
    };

    const registry = new PluginRegistry();
    registry.setConfirmCallback(async () => false);
    registry.register({
      name: 'reject',
      getTools: () => [{
        type: 'function',
        function: { name: 'side_effect_tool', description: 'test', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({ status: 'success' as const, data: 'should not reach' }),
    });

    const agent = new NanoCodeAgent({
      registry,
      llmClient: toolCallingMock('call_dsp_reject', 'side_effect_tool', '{}') as any,
      display: display as any,
    });
    await agent.runTask('run tool');

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'call_dsp_reject');
    assert.equal(results[0].status, 'rejected_by_user');
  });

  it('LLM 历史消息包含 tool_call_id', async () => {
    const registry = new PluginRegistry();
    registry.register({
      name: 'test',
      getTools: () => [{
        type: 'function',
        function: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({ status: 'success' as const, data: 'ok' }),
    });

    const agent = new NanoCodeAgent({
      registry,
      llmClient: toolCallingMock('call_dsp_003', 'echo', '{}') as any,
    });
    await agent.runTask('echo');

    const history = agent.getHistory();
    const toolMsg = history.find(m => m.role === 'tool');
    assert.ok(toolMsg, '应有 tool role 的消息');
    assert.equal(toolMsg!.tool_call_id, 'call_dsp_003');
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
    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
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
    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
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
    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('do something');

    const history = agent.getHistory();
    // Should still complete without crash
    const toolCalls = history.filter(m => m.role === 'tool');
    assert.ok(toolCalls.length > 0, 'should have tool responses');
  });

});

describe('NanoCodeAgent — newMessages injection', () => {

  it('injects newMessages from tool response into messageHistory before tool_result', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_nm',
              type: 'function',
              function: { name: 'inline_skill', arguments: '{"skill":"test"}' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'test-skill',
      getTools: () => [{
        type: 'function',
        function: { name: 'inline_skill', description: 'test', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({
        status: 'success' as const,
        message: 'skill launched',
        newMessages: [{ role: 'user' as const, content: 'skill instruction content' }],
      }),
    });

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('use skill');

    const history = agent.getHistory();
    // user + assistant(tool_call) + user(newMessage) + tool(result) + assistant(done)
    assert.equal(history.length, 5);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'use skill');
    assert.equal(history[1].role, 'assistant');
    assert.ok(history[1].tool_calls, 'should have tool_calls');
    // newMessage should be injected BEFORE tool_result
    assert.equal(history[2].role, 'user', 'third message should be newMessage');
    assert.equal(history[2].content, 'skill instruction content');
    // tool_result follows the newMessage
    assert.equal(history[3].role, 'tool', 'fourth message should be tool_result');
    assert.equal(history[4].role, 'assistant', 'fifth message should be final assistant');
    assert.equal(history[4].content, 'done');
  });

  it('handles multiple newMessages correctly', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_multi',
              type: 'function',
              function: { name: 'multi_skill', arguments: '{}' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'multi-skill',
      getTools: () => [{
        type: 'function',
        function: { name: 'multi_skill', description: 'test', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({
        status: 'success' as const,
        message: 'multi skill',
        newMessages: [
          { role: 'user' as const, content: 'step 1 instruction' },
          { role: 'user' as const, content: 'step 2 instruction' },
        ],
      }),
    });

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('do multi skill');

    const history = agent.getHistory();
    // user + assistant(tc) + user(nm1) + user(nm2) + tool(result) + assistant(done)
    assert.equal(history.length, 6);
    assert.equal(history[2].role, 'user');
    assert.equal(history[2].content, 'step 1 instruction');
    assert.equal(history[3].role, 'user');
    assert.equal(history[3].content, 'step 2 instruction');
    assert.equal(history[4].role, 'tool');
  });

  it('does not inject anything when newMessages is undefined', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [{
              id: 'call_normal',
              type: 'function',
              function: { name: 'normal_tool', arguments: '{}' },
            }],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'normal',
      getTools: () => [{
        type: 'function',
        function: { name: 'normal_tool', description: 'test', parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({ status: 'success' as const, data: 'normal result' }),
    });

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('normal task');

    const history = agent.getHistory();
    // user + assistant(tc) + tool(result) + assistant(done)
    assert.equal(history.length, 4);
    assert.equal(history[2].role, 'tool');
    assert.equal(history[2].content?.includes('normal result'), true);
  });

});

describe('NanoCodeAgent — parallel read-only tool execution', () => {

  it('all read-only tool results are pushed to messageHistory regardless of order', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'read_tool_a', arguments: '{}' } },
              { id: 'call_2', type: 'function', function: { name: 'read_tool_b', arguments: '{}' } },
            ],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    const toolNames: string[] = [];
    registry.register({
      name: 'reader',
      getTools: () => [
        {
          type: 'function',
          function: { name: 'read_tool_a', description: 'read-only a', sideEffect: false, parameters: { type: 'object', properties: {} } },
        },
        {
          type: 'function',
          function: { name: 'read_tool_b', description: 'read-only b', sideEffect: false, parameters: { type: 'object', properties: {} } },
        },
      ],
      execute: async (name: string) => {
        toolNames.push(name);
        return { status: 'success' as const, data: `result from ${name}` };
      },
    });

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('run both tools');

    const history = agent.getHistory();
    // user + assistant(tc) + tool(a) + tool(b) + assistant(done)
    const toolMsgs = history.filter(m => m.role === 'tool');
    assert.equal(toolMsgs.length, 2, 'both tool results should be in history');
    assert.ok(toolMsgs[0].content?.includes('read_tool_a'), 'first tool result should be for read_tool_a');
    assert.ok(toolMsgs[1].content?.includes('read_tool_b'), 'second tool result should be for read_tool_b');
    // Verify both tools actually executed
    assert.equal(toolNames.length, 2, 'both tools should have been executed');
    assert.ok(toolNames.includes('read_tool_a'));
    assert.ok(toolNames.includes('read_tool_b'));
  });

  it('handles single read-only tool correctly', async () => {
    let callCount = 0;
    const mock = {
      sendSystemMessage: async (_messages: any, _tools: any, _onChunk?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            text: null,
            toolCalls: [
              { id: 'call_single', type: 'function', function: { name: 'read_tool', arguments: '{}' } },
            ],
            stopReason: 'tool_use',
          };
        }
        return { text: 'done', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const registry = new PluginRegistry();
    registry.register({
      name: 'reader',
      getTools: () => [{
        type: 'function',
        function: { name: 'read_tool', description: 'read-only', sideEffect: false, parameters: { type: 'object', properties: {} } },
      }],
      execute: async () => ({ status: 'success' as const, data: 'single result' }),
    });

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    await agent.runTask('run tool');

    const history = agent.getHistory();
    const toolMsgs = history.filter(m => m.role === 'tool');
    assert.equal(toolMsgs.length, 1);
    assert.ok(toolMsgs[0].content?.includes('single result'));
  });

});

describe('NanoCodeAgent — cancellation', () => {

  it('breaks immediately when cancelled before runTask', async () => {
    const registry = new PluginRegistry();
    registry.store.set('agent:cancelled', true);
    let llmCalled = false;
    const mock = {
      sendSystemMessage: async (..._args: any[]) => {
        llmCalled = true;
        return { text: 'should not happen', stopReason: 'stop' };
      },
      getModel: () => 'gpt-4o',
    };

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    const result = await agent.runTask('hello');

    assert.equal(llmCalled, false, 'LLM should not be called when cancelled');
    assert.equal(result, undefined);
  });

  it('handles AbortError from LLM gracefully', async () => {
    const registry = new PluginRegistry();
    const mock = {
      sendSystemMessage: async (_msgs: any, _tools: any, _onChunk?: any, _extra?: any, _onMeta?: any, signal?: AbortSignal) => {
        signal?.addEventListener('abort', () => {});
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
      getModel: () => 'gpt-4o',
    };

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mock as any });
    registry.store.set(SK.AgentAbort, new AbortController());
    registry.store.set(SK.AgentCancelled, true);

    const result = await agent.runTask('hello');
    assert.equal(result, undefined);
  });

  it('clears cancel flag from store after handling', async () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentCancelled, true);

    const agent = new NanoCodeAgent({ registry: registry, llmClient: mockLLM() });
    await agent.runTask('hello');

    assert.equal(registry.store.get(SK.AgentCancelled), undefined);
  });

});
