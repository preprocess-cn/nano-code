import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry, NanoPlugin, ToolCall, LLMResponse } from '../src/core/plugin.js';
import { ToolResponse, ToolDefinition, CommandOutputHandler } from '../src/core/contract.js';
import { ChatMessage } from '../src/core/llm.js';

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

// ── listPlugins ──

describe('PluginRegistry — listPlugins', () => {
  it('returns empty array when no plugins', () => {
    const r = new PluginRegistry();
    assert.deepEqual(r.listPlugins(), []);
  });

  it('includes plugin name, description, version and tools', async () => {
    const r = new PluginRegistry();
    const p: NanoPlugin = {
      name: 'my-plugin',
      description: 'My test plugin',
      version: '1.0.0',
      getTools() {
        return [{
          type: 'function',
          function: { name: 'my_tool', description: 'A tool', parameters: { type: 'object', properties: {} } },
        }];
      },
      async execute() { return { status: 'success' as const, data: 'ok' }; },
    };
    await r.register(p);
    const list = r.listPlugins();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'my-plugin');
    assert.equal(list[0].description, 'My test plugin');
    assert.equal(list[0].version, '1.0.0');
    assert.equal(list[0].tools.length, 1);
    assert.equal(list[0].tools[0].function.name, 'my_tool');
  });
});

// ── execute ──

describe('PluginRegistry — execute', () => {
  it('routes to correct plugin', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1', ['t1']));
    const result = await r.execute('t1', {});
    assert.equal(result.status, 'success');
    assert.match(result.data!, /p1/);
  });

  it('returns error for unknown tool', async () => {
    const r = new PluginRegistry();
    const result = await r.execute('unknown', {});
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
    const result = await r.execute('t1', {});
    assert.equal(result.status, 'error');
    assert.match(result.message!, /boom/);
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

  it('execAfterRequest passes rawMeta to plugins', async () => {
    const r = new PluginRegistry();
    const captured: any[] = [];
    await r.register({
      ...createMockPlugin('p1'),
      onAfterRequest: (_resp: LLMResponse, meta?: Record<string, unknown>) => { captured.push(meta); },
    });
    const meta = { promptTokens: 10, completionTokens: 20 };
    r.execAfterRequest({ text: 'hi' }, meta);
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], meta);
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

  it('collectExtraParams returns empty object when no plugin defines hook', async () => {
    const r = new PluginRegistry();
    await r.register(createMockPlugin('p1'));
    assert.deepEqual(r.collectExtraParams(), {});
  });

  it('collectExtraParams returns params from single plugin', async () => {
    const r = new PluginRegistry();
    await r.register({
      ...createMockPlugin('p1'),
      onExtraParams: () => ({ max_tokens: 4096 }),
    });
    assert.deepEqual(r.collectExtraParams(), { max_tokens: 4096 });
  });

  it('collectExtraParams merges params from multiple plugins (later wins)', async () => {
    const r = new PluginRegistry();
    await r.register({
      ...createMockPlugin('p1'),
      onExtraParams: () => ({ max_tokens: 2048, top_k: 10 }),
    });
    await r.register({
      ...createMockPlugin('p2'),
      onExtraParams: () => ({ max_tokens: 4096 }),  // 覆盖 p1 的 max_tokens
    });
    const result = r.collectExtraParams();
    assert.equal(result.max_tokens, 4096);  // p2 覆盖
    assert.equal(result.top_k, 10);          // p1 的保留
  });

  it('plugin error in onExtraParams does not break chain', async () => {
    const r = new PluginRegistry();
    await r.register({
      ...createMockPlugin('p1'),
      onExtraParams: () => { throw new Error('oops'); },
    });
    await r.register({
      ...createMockPlugin('p2'),
      onExtraParams: () => ({ top_k: 50 }),
    });
    const result = r.collectExtraParams();
    assert.deepEqual(result, { top_k: 50 });
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

// ── Store integration on PluginRegistry ──

describe('PluginRegistry — store integration', () => {

  it('registry has a store instance', () => {
    const r = new PluginRegistry();
    assert.ok(r.store, 'store should exist');
    assert.equal(typeof r.store.get, 'function');
    assert.equal(typeof r.store.set, 'function');
    assert.equal(typeof r.store.subscribe, 'function');
  });

  it('plugins can access store via registry', async () => {
    const r = new PluginRegistry();
    let stored: any = null;
    const p: NanoPlugin = {
      ...createMockPlugin('p1'),
      async onInit(registry: PluginRegistry) {
        registry.store.set('test', { from: 'p1' });
        stored = registry.store.get('test');
      },
    };
    await r.register(p);
    assert.deepEqual(stored, { from: 'p1' });
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

describe('PluginRegistry — permission allowlist', () => {
  it('isToolAllowed returns false by default', () => {
    const r = new PluginRegistry();
    assert.equal(r.isToolAllowed('run_bash_command'), false);
  });

  it('allowTool adds tool to allowlist', () => {
    const r = new PluginRegistry();
    r.allowTool('run_bash_command');
    assert.equal(r.isToolAllowed('run_bash_command'), true);
  });

  it('allowlist persists across multiple calls', () => {
    const r = new PluginRegistry();
    r.allowTool('tool_a');
    r.allowTool('tool_b');
    assert.equal(r.isToolAllowed('tool_a'), true);
    assert.equal(r.isToolAllowed('tool_b'), true);
    assert.equal(r.isToolAllowed('tool_c'), false);
  });

  it('getAllowedTools returns allowed tool names', () => {
    const r = new PluginRegistry();
    r.allowTool('a');
    r.allowTool('b');
    const allowed = r.getAllowedTools();
    assert.equal(allowed.length, 2);
    assert.ok(allowed.includes('a'));
    assert.ok(allowed.includes('b'));
  });

  it('clearPermissions resets allowlist', () => {
    const r = new PluginRegistry();
    r.allowTool('run_bash_command');
    assert.equal(r.isToolAllowed('run_bash_command'), true);
    r.clearPermissions();
    assert.equal(r.isToolAllowed('run_bash_command'), false);
  });

  it('skipPermissionScope skips all permission checks', () => {
    const r = new PluginRegistry();
    assert.equal(r.isSkipPermissionScope(), false);
    r.setSkipPermissionScope(true);
    assert.equal(r.isSkipPermissionScope(), true);
    r.setSkipPermissionScope(false);
    assert.equal(r.isSkipPermissionScope(), false);
  });
});

describe('PluginRegistry — output handler', () => {
  it('getOutputHandler returns undefined when not set', () => {
    const r = new PluginRegistry();
    assert.equal(r.getOutputHandler(), undefined);
  });

  it('getOutputHandler returns the handler set by setOutputHandler', () => {
    const r = new PluginRegistry();
    const captured: string[] = [];
    const handler: CommandOutputHandler = {
      stdout(chunk: string) { captured.push(chunk); },
      stderr() {},
    };
    r.setOutputHandler(handler);
    assert.equal(r.getOutputHandler(), handler);
    // 验证 handler 可正常调用
    r.getOutputHandler()!.stdout('test');
    assert.deepEqual(captured, ['test']);
  });
});
