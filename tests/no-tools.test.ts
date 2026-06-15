import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/plugin.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { ToolResponse } from '../src/contract.js';

describe('No tools configured — pure chat mode', () => {

  it('returns empty schemas when no plugins are registered', () => {
    const registry = new PluginRegistry();
    assert.equal(registry.getAllSchemas().length, 0);
  });

  it('builds chat-oriented system prompt when no tools exist', () => {
    const registry = new PluginRegistry();
    const msg = buildSystemPrompt(registry);

    assert.equal(msg.role, 'system');
    assert.ok(msg.content);
    // Chat mode: "AI 对话助手" appears, tool-specific instructions do not
    assert.ok(msg.content!.includes('AI 对话助手'));
    assert.ok(!msg.content!.includes('【核心安全约束】'));
    assert.ok(!msg.content!.includes('rejected_by_user'));
  });

  it('executing any tool on empty registry returns unknown-tool error', async () => {
    const registry = new PluginRegistry();

    const result1 = JSON.parse(await registry.execute('view_file_content', { path: 'x.ts' }));
    assert.equal(result1.status, 'error');
    assert.ok(result1.message.includes('Unknown tool'));

    const result2 = JSON.parse(await registry.execute('run_bash_command', { command: 'ls' }));
    assert.equal(result2.status, 'error');
    assert.ok(result2.message.includes('Unknown tool'));
  });

  it('system prompt switches to tool instructions when plugins are registered', async () => {
    const registry = new PluginRegistry();
    await registry.register({
      name: 'mock',
      getTools() {
        return [{
          type: 'function' as const,
          function: {
            name: 'mock_tool',
            description: 'a test tool',
            parameters: { type: 'object', properties: {} },
          },
        }];
      },
      async execute(): Promise<ToolResponse> {
        return { status: 'success', data: 'mock executed' };
      },
    });

    const msg = buildSystemPrompt(registry);
    // Tool mode: "AI 编程助手" and safety constraints appear
    assert.ok(msg.content!.includes('AI 编程助手'));
    assert.ok(msg.content!.includes('【核心安全约束】'));
    assert.ok(msg.content!.includes('rejected_by_user'));
  });

});
