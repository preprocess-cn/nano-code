import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry, NanoPlugin, ToolCall, LLMResponse } from '../src/plugin.js';
import { ToolResponse, ToolDefinition } from '../src/contract.js';
import { ChatMessage } from '../src/llm.js';

// ── Helpers ──

function createMockPlugin(name: string, tools: string[] = []): NanoPlugin {
  return {
    name,
    getTools(): ToolDefinition[] {
      return tools.map(t => ({
        type: 'function' as const,
        function: { name: t, description: `Tool ${t}`, parameters: { type: 'object', properties: {} } },
      }));
    },
    async execute(_name: string, _args: any): Promise<ToolResponse> {
      return { status: 'success', data: `${name} executed ${_name}` };
    },
  };
}

function createToolCall(name = 'test_tool', args = '{}'): ToolCall {
  return { id: 'call_1', function: { name, arguments: args } };
}

// ── register / unregister ──

describe('PluginRegistry — register / unregister', () => {
  it('registers a plugin and indexes its tools', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['tool_a', 'tool_b']));
    assert.equal(r.getAllSchemas().length, 2);
  });

  it('warns and replaces when registering duplicate name', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['t1']));
    await r.register(createMockPlugin('p1', ['t2']));
    const schemas = r.getAllSchemas();
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].function.name, 't2');
  });

  it('unregister removes plugin and its tools', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['t1']));
    await r.unregister('p1');
    assert.equal(r.getAllSchemas().length, 0);
  });

  it('unregister on non-existent name is a no-op', async () => {
    const r = new PluginRegistry();
    await r.unregister('nonexistent');
    assert.equal(r.getAllSchemas().length, 0);
  });

  it('calls onInit on register', async () => {
    const r = new PluginRegistry();
    let inited = false;
    const p: NanoPlugin = { ...createMockPlugin('p1'), async onInit() { inited = true; } };
    await r.register(p);
    assert.equal(inited, true);
  });

  it('calls onDestroy on unregister', async () => {
    const r = new PluginRegistry();
    let destroyed = false;
    const p: NanoPlugin = { ...createMockPlugin('p1'), async onDestroy() { destroyed = true; } };
    await r.register(p);
    await r.unregister('p1');
    assert.equal(destroyed, true);
  });

  it('onInit error does not crash registry', async () => {
    const r = new PluginRegistry();
    const p: NanoPlugin = { ...createMockPlugin('p1', ['t1']), async onInit() { throw new Error('init fail'); } };
    await r.register(p);
    assert.equal(r.getAllSchemas().length, 1);
  });

  it('unregister clears plugin config', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1'));
    r.setPluginConfig('p1', { key: 'val' });
    assert.deepEqual(r.getPluginConfig('p1'), { key: 'val' });
    await r.unregister('p1');
    assert.deepEqual(r.getPluginConfig('p1'), {});
  });
});

// ── getAllSchemas ──

describe('PluginRegistry — getAllSchemas', () => {
  it('returns empty array with no plugins', () => {
    const r = new PluginRegistry();
    assert.deepEqual(r.getAllSchemas(), []);
  });

  it('aggregates tools from all plugins', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['a', 'b']));
    await r.register(createMockPlugin('p2', ['c']));
    assert.equal(r.getAllSchemas().length, 3);
  });
});

// ── execute ──

describe('PluginRegistry — execute', () => {
  it('routes to correct plugin', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['t1']));
    const result = JSON.parse(await r.execute('t1', {}));
    assert.equal(result.status, 'success');
    assert.match(result.data, /p1/);
  });

  it('returns error for unknown tool', async () => {
    const r = new PluginRegistry();
    const result = JSON.parse(await r.execute('unknown', {}));
    assert.equal(result.status, 'error');
  });

  it('uses defaultContext defaults', async () => {
    const r = new PluginRegistry();
    const captured: any[] = [];
    const p: NanoPlugin = {
      ...createMockPlugin('p1', ['t1']),
      async execute(_name: string, _args: any, ctx: any) {
        captured.push(ctx);
        return { status: 'success', data: 'ok' };
      },
    };
    r.setDefaultContext({ skipPermission: true, defaultTimeout: 5000 });
    await r.register(p);
    await r.execute('t1', {});
    assert.equal(captured[0].skipPermission, true);
    assert.equal(captured[0].defaultTimeout, 5000);
  });

  it('per-call ctx overrides defaultContext', async () => {
    const r = new PluginRegistry();
    const captured: any[] = [];
    const p: NanoPlugin = {
      ...createMockPlugin('p1', ['t1']),
      async execute(_name: string, _args: any, ctx: any) {
        captured.push(ctx);
        return { status: 'success', data: 'ok' };
      },
    };
    r.setDefaultContext({ skipPermission: false });
    await r.register(p);
    await r.execute('t1', {}, { skipPermission: true });
    assert.equal(captured[0].skipPermission, true);
  });

  it('tool execution error returns error response', async () => {
    const r = new PluginRegistry();
    const p: NanoPlugin = {
      ...createMockPlugin('p1', ['t1']),
      async execute() { throw new Error('boom'); },
    };
    await r.register(p);
    const result = JSON.parse(await r.execute('t1', {}));
    assert.equal(result.status, 'error');
    assert.match(result.message, /boom/);
  });
});

// ── Hooks ──

describe('PluginRegistry — hooks', () => {
  it('execSystemPrompt chains through plugins in order', async () => {
    const r = new PluginRegistry();
    await r.register({ ...createMockPlugin('p1'), onSystemPrompt: (t: string) => t + ' +p1' });
    await r.register({ ...createMockPlugin('p2'), onSystemPrompt: (t: string) => t + ' +p2' });
    assert.equal(r.execSystemPrompt('base'), 'base +p1 +p2');
  });

  it('execBeforeRequest chains messages through plugins', async () => {
    const r = new PluginRegistry();
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    await r.register({
      ...createMockPlugin('p1'),
      onBeforeRequest: (m: ChatMessage[]) => [...m, { role: 'user', content: 'p1' }],
    });
    const result = r.execBeforeRequest(msgs);
    assert.equal(result.length, 2);
    assert.equal(result[1].content, 'p1');
  });

  it('execAfterRequest notifies all plugins', async () => {
    const r = new PluginRegistry();
    const seen: string[] = [];
    const resp: LLMResponse = { text: 'hello' };
    await r.register({ ...createMockPlugin('p1'), onAfterRequest: () => { seen.push('p1'); } });
    await r.register({ ...createMockPlugin('p2'), onAfterRequest: () => { seen.push('p2'); } });
    r.execAfterRequest(resp);
    assert.deepEqual(seen, ['p1', 'p2']);
  });

  it('execBeforeToolCall short-circuits on first null', async () => {
    const r = new PluginRegistry();
    const tc = createToolCall();
    let p2Called = false;
    await r.register({
      ...createMockPlugin('p1'),
      onBeforeToolCall: () => null,
    });
    await r.register({
      ...createMockPlugin('p2'),
      onBeforeToolCall: () => { p2Called = true; return tc; },
    });
    const result = r.execBeforeToolCall(tc);
    assert.equal(result, null);
    assert.equal(p2Called, false);
  });

  it('execAfterToolCall chains results', async () => {
    const r = new PluginRegistry();
    const res: ToolResponse = { status: 'success', data: 'original' };
    await r.register({
      ...createMockPlugin('p1'),
      onAfterToolCall: (r: ToolResponse) => ({ ...r, data: r.data + ' +p1' }),
    });
    await r.register({
      ...createMockPlugin('p2'),
      onAfterToolCall: (r: ToolResponse) => ({ ...r, data: r.data + ' +p2' }),
    });
    const result = r.execAfterToolCall(res);
    assert.equal(result.data, 'original +p1 +p2');
  });

  it('plugin errors in hooks do not break chain', async () => {
    const r = new PluginRegistry();
    await r.register({ ...createMockPlugin('p1'), onSystemPrompt: () => { throw new Error('oops'); } });
    await r.register({ ...createMockPlugin('p2'), onSystemPrompt: (t: string) => t + ' +p2' });
    const result = r.execSystemPrompt('base');
    assert.equal(result, 'base +p2');
  });

  it('execBeforeToolCall error continues to next plugin', async () => {
    const r = new PluginRegistry();
    const tc = createToolCall();
    await r.register({ ...createMockPlugin('p1'), onBeforeToolCall: () => { throw new Error('fail'); } });
    await r.register({ ...createMockPlugin('p2'), onBeforeToolCall: () => tc });
    const result = r.execBeforeToolCall(tc);
    assert.notEqual(result, null);
    assert.equal(result!.function.name, 'test_tool');
  });
});

// ── Config namespace isolation ──

describe('PluginRegistry — config isolation', () => {
  it('setPluginConfig / getPluginConfig round-trip', () => {
    const r = new PluginRegistry();
    r.setPluginConfig('p1', { key: 'val' });
    assert.deepEqual(r.getPluginConfig('p1'), { key: 'val' });
  });

  it('returns {} for unknown plugin', () => {
    const r = new PluginRegistry();
    assert.deepEqual(r.getPluginConfig('nonexistent'), {});
  });

  it('plugins cannot read each others config', () => {
    const r = new PluginRegistry();
    r.setPluginConfig('p1', { secret: 'p1-data' });
    r.setPluginConfig('p2', { secret: 'p2-data' });
    assert.equal(r.getPluginConfig('p1').secret, 'p1-data');
    assert.equal(r.getPluginConfig('p2').secret, 'p2-data');
    assert.notEqual(r.getPluginConfig('p1').secret, r.getPluginConfig('p2').secret);
  });
});
