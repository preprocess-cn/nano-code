import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/core/plugin.js';
import { createTokenBudgetPlugin } from '../src/plugins/token-budget/index.js';
import { ChatMessage } from '../src/core/llm.js';

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

  it('injects isMeta flag on hard stop message', () => {
    const plugin = createTokenBudgetPlugin({
      maxTokensPerSession: 10,
      compressionThreshold: 100,
    });
    plugin.onAfterRequest!({ text: 'x'.repeat(100), toolCalls: undefined });

    const msgs = makeMsgs(5, 'hello');
    const result = plugin.onBeforeRequest!(msgs);
    const last = result[result.length - 1];
    assert.equal(last.isMeta, true);
    assert.match(last.content!, /token budget/);
  });

  it('does not reject tool calls (onBeforeToolCall removed per Claude Code pattern)', () => {
    const plugin = createTokenBudgetPlugin({ maxTokensPerSession: 10 });
    // Simply verify the method does not exist — budget enforcement
    // is done via onBeforeRequest, not tool call interception
    assert.equal((plugin as any).onBeforeToolCall, undefined);
  });

  it('injects isMeta flag on compression hint', () => {
    const plugin = createTokenBudgetPlugin({
      maxTokensPerSession: 100000,
      compressionThreshold: 10,
    });
    plugin.onAfterRequest!({ text: 'x'.repeat(60), toolCalls: undefined });

    const msgs = makeMsgs(3, 'hi');
    const result = plugin.onBeforeRequest!(msgs);
    const last = result[result.length - 1];
    assert.equal(last.isMeta, true);
    assert.match(last.content!, /简洁/);
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
    // rawMeta empty → text-based estimation → onBeforeRequest should pass through (under budget)
    plugin.onAfterRequest!({ text: 'hello' });
    const msgs = makeMsgs(2, 'hi');
    const result = plugin.onBeforeRequest!(msgs);
    assert.equal(result.length, msgs.length, 'should pass through when under budget');

    // Reset: inject exact token counts via rawMeta, exceed budget
    const plugin2 = createTokenBudgetPlugin({ maxTokensPerSession: 9 });
    plugin2.onAfterRequest!({ text: 'tiny' }, { promptTokens: 5, completionTokens: 5, totalTokens: 10 });

    // Over budget now → onBeforeRequest should inject hard stop
    const msgs2 = makeMsgs(2, 'hi');
    const result2 = plugin2.onBeforeRequest!(msgs2);
    const last = result2[result2.length - 1];
    assert.equal(last.isMeta, true, 'should set isMeta on hard stop message');
    assert.match(last.content!, /token budget/, 'should inject budget exceeded message');
  });

  it('can be registered as a NanoPlugin', async () => {
    const r = new PluginRegistry();
    const plugin = createTokenBudgetPlugin();
    await r.register(plugin);

    assert.equal(plugin.name, 'token-budget');
    assert.equal(r.getAllSchemas().length, 0);
  });
});

// ── /context analyzer: Tools 与 MCP Tools 互斥 ──

import { NanoConfig } from '../src/core/config.js';
import { ToolDefinition } from '../src/core/contract.js';
import { NanoPlugin } from '../src/core/plugin.js';
import { analyzeContextUsage } from '../src/plugins/token-budget/analyzer.js';

function makeTool(name: string): ToolDefinition {
  return {
    type: 'function',
    function: { name, description: `tool ${name}`, parameters: {} },
  };
}

function makePlugin(name: string, tools: string[]): NanoPlugin {
  return {
    name,
    getTools: () => tools.map(makeTool),
    execute: async (_n: string, _a: any) => ({ status: 'success' as const }),
  };
}

/**
 * 当 registry 中同时存在 MCP 插件和普通插件时，
 * Tools 维度不应包含 MCP 工具，MCP Tools 维度不应包含普通工具。
 */
it('analyzeContextUsage: Tools and MCP Tools dimensions are mutually exclusive', async () => {
  const r = new PluginRegistry();
  await r.register(makePlugin('mcp:codebase-memory', ['search_code', 'query_graph']));
  await r.register(makePlugin('mcp:filesystem', ['read_file', 'write_file']));
  await r.register(makePlugin('my-tools', ['list_files', 'delete_file']));

  const mockAgent = { getHistory: () => [] } as any;
  const mockConfig: NanoConfig = {
    configVersion: 1,
    core: { maxTokens: 128000, defaultTimeout: 30000 },
    plugins: {},
  };

  const analysis = analyzeContextUsage(mockAgent, r, mockConfig);

  const toolsDim = analysis.dimensions.find(d => d.name === 'Tools');
  const mcpDim = analysis.dimensions.find(d => d.name === 'MCP Tools');

  assert.ok(toolsDim, 'Tools dimension should exist');
  assert.ok(mcpDim, 'MCP Tools dimension should exist');

  const toolNames = new Set(toolsDim.items.map(i => i.name));
  const mcpNames = new Set(mcpDim.items.map(i => i.name));

  // Verify no overlap
  const overlap = [...toolNames].filter(n => mcpNames.has(n));
  assert.equal(overlap.length, 0, `Tools and MCP Tools should not overlap, but found: ${overlap.join(', ')}`);

  // Verify MCP tools are in MCP dimension
  assert.ok(mcpNames.has('search_code'), 'MCP tool search_code should be in MCP Tools');
  assert.ok(mcpNames.has('query_graph'), 'MCP tool query_graph should be in MCP Tools');
  assert.ok(mcpNames.has('read_file'), 'MCP tool read_file should be in MCP Tools');

  // Verify non-MCP tools are in Tools dimension
  assert.ok(toolNames.has('list_files'), 'non-MCP tool list_files should be in Tools');
  assert.ok(toolNames.has('delete_file'), 'non-MCP tool delete_file should be in Tools');
});
