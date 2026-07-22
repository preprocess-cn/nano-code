import { describe, it, afterEach, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAgentCoordinatorPlugin } from '../src/plugins/coordinator/coordinator.js';
import { MessageBus } from '../src/plugins/coordinator/message-bus.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { LLMClient, ChatMessage } from '../src/core/llm.js';

function mockLLMClient() {
  return {
    model: 'test-model',
    temperature: 0,
  } as unknown as LLMClient;
}

function createTempAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-agent-test-'));
  const yaml = [
    'name: dba',
    'description: Database admin agent',
    'role: You are a DBA.',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'dba.yaml'), yaml, 'utf-8');
  return dir;
}

describe('AgentCoordinator', () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = createTempAgentDir();
  });

  afterEach(() => {
    MessageBus.resetInstance();
    try { fs.rmSync(agentDir, { recursive: true, force: true }); } catch {}
  });

  it('onSystemPrompt adds agent section when no header exists', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient(), undefined, undefined, [agentDir]);
    const result = plugin.onSystemPrompt!('You are a helpful assistant.');
    assert.ok(result.includes('## Specialist Agents'));
    assert.ok(result.includes('agent-'));
  });

  it('onSystemPrompt does not produce duplicate headers on multiple calls', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient(), undefined, undefined, [agentDir]);
    // Each call is independent — no accumulation across calls
    const first = plugin.onSystemPrompt!('Base prompt.');
    const second = plugin.onSystemPrompt!('Base prompt.');
    const count = (second.match(/## Specialist Agents/g) || []).length;
    assert.equal(count, 1, 'should have exactly one Specialist Agents header');
  });

  it('onSystemPrompt includes usage subsections when agents exist', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient(), undefined, undefined, [agentDir]);
    const result = plugin.onSystemPrompt!('Base prompt.');

    if (result.includes('## Specialist Agents')) {
      assert.ok(result.includes('使用方式'), 'should have usage section');
      assert.ok(result.includes('Agent 间通信'), 'should have inter-agent communication section');
      assert.ok(result.includes('send_message'), 'should mention send_message');
    }
  });

  it('onSystemPrompt preserves base prompt content', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const input = 'Base prompt.';
    const result = plugin.onSystemPrompt!(input);
    // 基础提示词始终被保留，agent 段落按需追加
    assert.ok(result.startsWith(input));
    assert.ok(result.length >= input.length);
  });

  it('onBeforeRequest is no-op when no pending messages', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];
    const result = plugin.onBeforeRequest!(messages);
    assert.equal(result, messages);
    assert.equal(result.length, 2);
  });

  it('onInit does not throw when no agent definitions', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const registry = new PluginRegistry();
    // 无 agent 定义时，onInit 应正常完成且不报错
    await plugin.onInit!(registry);
    // 不应注册 send_message 工具（需有 agent 定义才会注册）
    const sendTool = registry.getAllSchemas().find(t => t.function.name === 'send_message');
    assert.equal(sendTool, undefined);
  });

  // ── Phase 3: send_message ──

  it('provides send_message tool', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const tools = plugin.getTools();
    const sendTool = tools.find((t) => t.function.name === 'send_message');
    assert.ok(sendTool, 'should have send_message tool');
    assert.equal(sendTool?.function.sideEffect, false);
    assert.ok(sendTool?.function.parameters.properties.to);
    assert.ok(sendTool?.function.parameters.properties.summary);
    assert.ok(sendTool?.function.parameters.properties.message);
  });

  it('send_message routes to MessageBus', async () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('send_message', {
      to: 'dba', summary: 'Hi', message: 'Hello',
    }, { skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false });

    assert.equal(result.status, 'success');
    assert.equal(bus.pendingCount('task_1'), 1);
  });

  it('send_message with missing to returns error', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('send_message', {
      summary: 'Hi', message: 'Hello',
    }, { skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('to'));
  });

  it('send_message with missing summary returns error', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('send_message', {
      to: 'dba', message: 'Hello',
    }, { skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('summary'));
  });

  it('send_message to unknown returns error', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('send_message', {
      to: 'nonexistent', summary: 'Hi', message: 'Hello',
    }, { skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('未找到'));
  });

  it('onBeforeRequest injects mailbox messages for main agent', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('main', 'main');
    bus.registerAgent('task_1', 'dba');
    bus.send('task_1', 'dba', 'main', 'Done', 'Analysis complete');

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];
    const result = plugin.onBeforeRequest!(messages);
    assert.equal(result.length, 3); // system + msg notification + original user
    assert.ok(result[1].content!.includes('agent 发来的消息'));
    assert.ok(result[1].content!.includes('Analysis complete'));
  });
});
