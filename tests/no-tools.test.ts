import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/core/plugin.js';
import { buildSystemPrompt } from '../src/core/prompt.js';
import { SystemPromptConfig } from '../src/core/config.js';
import { ToolResponse } from '../src/core/contract.js';

const MOCK_PROMPT = {
  noTools: '你是一个名为 nano-code 的 {role}。请保持回答简洁专业。',
  withTools: '你是一个名为 nano-code 的 {role}。你可以调用以下工具来完成工作：{tool_list}。\n\n【核心安全约束】如果用户拒绝（rejected_by_user），立即停止。',
};

describe('No tools configured — pure chat mode', () => {

  it('returns empty schemas when no plugins are registered', () => {
    const registry = new PluginRegistry();
    assert.equal(registry.getAllSchemas().length, 0);
  });

  it('builds chat-oriented system prompt when no tools exist', () => {
    const registry = new PluginRegistry();
    const msg = buildSystemPrompt(registry, MOCK_PROMPT);

    assert.equal(msg.role, 'system');
    assert.ok(msg.content);
    // Chat mode: "AI 对话助手" appears, no safety constraints
    assert.ok(msg.content!.includes('AI 对话助手'));
    assert.ok(!msg.content!.includes('【核心安全约束】'));
    assert.ok(!msg.content!.includes('rejected_by_user'));
  });

  it('executing any tool on empty registry returns unknown-tool error', async () => {
    const registry = new PluginRegistry();

    const result1 = await registry.execute('view_file_content', { path: 'x.ts' });
    assert.equal(result1.status, 'error');
    assert.ok(result1.message!.includes('未知工具'));

    const result2 = await registry.execute('run_bash_command', { command: 'ls' });
    assert.equal(result2.status, 'error');
    assert.ok(result2.message!.includes('未知工具'));
  });

  it('uses custom agentRole in chat mode when provided', () => {
    const registry = new PluginRegistry();
    const msg = buildSystemPrompt(registry, MOCK_PROMPT, '数据库管理员');
    assert.ok(msg.content!.includes('数据库管理员'));
    assert.ok(!msg.content!.includes('【核心安全约束】'));
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

    const msg = buildSystemPrompt(registry, MOCK_PROMPT);
    // Tool mode: "AI 编程助手" and safety constraints appear
    assert.ok(msg.content!.includes('AI 编程助手'));
    assert.ok(msg.content!.includes('【核心安全约束】'));
    assert.ok(msg.content!.includes('rejected_by_user'));
  });

  it('uses custom agentRole in tool mode when provided', async () => {
    const registry = new PluginRegistry();
    await registry.register({
      name: 'mock2',
      getTools() {
        return [{
          type: 'function' as const,
          function: {
            name: 'mock_tool2',
            description: 'another test tool',
            parameters: { type: 'object', properties: {} },
          },
        }];
      },
      async execute(): Promise<ToolResponse> {
        return { status: 'success', data: 'ok' };
      },
    });
    const msg = buildSystemPrompt(registry, MOCK_PROMPT, '部署运维助手');
    assert.ok(msg.content!.includes('部署运维助手'));
    assert.ok(msg.content!.includes('【核心安全约束】'));
  });

});
