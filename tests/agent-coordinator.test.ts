import { describe, it, afterEach, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgentCoordinatorPlugin } from '../src/agent-coordinator.js';
import { BackgroundTaskManager } from '../src/background-task-manager.js';
import { MessageBus } from '../src/agent-message-bus.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { LLMClient, ChatMessage } from '../src/core/llm.js';

function mockLLMClient() {
  return {
    model: 'test-model',
    temperature: 0,
  } as unknown as LLMClient;
}

describe('AgentCoordinator', () => {
  beforeEach(() => {
    // Use a temp agent directory to avoid loading real agent definitions
  });

  afterEach(() => {
    BackgroundTaskManager.resetInstance();
    MessageBus.resetInstance();
  });

  it('provides agent_task_status tool', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const tools = plugin.getTools();
    assert.ok(tools.length >= 1);
    const statusTool = tools.find((t) => t.function.name === 'agent_task_status');
    assert.ok(statusTool, 'should have agent_task_status tool');
    assert.equal(statusTool?.function.sideEffect, false);
  });

  it('agent_task_status returns empty list when no tasks exist', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('agent_task_status', {}, {
      skipPermission: true,
      cwd: process.cwd(),
      defaultTimeout: 30000,
      sideEffect: false,
    });
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);
  });

  it('agent_task_status returns specific task', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'query', async () => 'result');

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('agent_task_status', { task_id: id }, {
      skipPermission: true,
      cwd: process.cwd(),
      defaultTimeout: 30000,
      sideEffect: false,
    });
    assert.equal(result.status, 'success');
    const task = JSON.parse(result.data!);
    assert.equal(task.agentName, 'test');
    assert.equal(task.query, 'query');
  });

  it('agent_task_status returns error for unknown task', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = await plugin.execute('agent_task_status', { task_id: 'nonexistent' }, {
      skipPermission: true,
      cwd: process.cwd(),
      defaultTimeout: 30000,
      sideEffect: false,
    });
    assert.equal(result.status, 'error');
  });

  it('onSystemPrompt adds agent section when no header exists', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = plugin.onSystemPrompt!('You are a helpful assistant.');
    assert.ok(result.includes('## Specialist Agents'));
    assert.ok(result.includes('agent-'));
  });

  it('onSystemPrompt with running tasks includes running section', () => {
    const mgr = BackgroundTaskManager.getInstance();
    mgr.startTask('dba', 'analyze schema', () => new Promise(() => {}));

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = plugin.onSystemPrompt!('Base prompt.');
    assert.ok(result.includes('Running Background Tasks'));
    assert.ok(result.includes('dba'));
  });

  it('onSystemPrompt without running tasks omits running section', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const result = plugin.onSystemPrompt!('Base prompt.');
    assert.ok(!result.includes('Running Background Tasks'));
  });

  it('onBeforeRequest injects completed task notification', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    mgr.startTask('test-agent', 'test query', async () => 'done!');
    await new Promise((r) => setTimeout(r, 10));

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];
    const result = plugin.onBeforeRequest!(messages);
    assert.equal(result.length, 3); // system + notification + original user
    assert.ok(result[1].content!.includes('已完成的后台任务'));
    assert.ok(result[1].content!.includes('done!'));
  });

  it('onBeforeRequest is no-op when no completed tasks', () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];
    const result = plugin.onBeforeRequest!(messages);
    assert.equal(result, messages);
    assert.equal(result.length, 2);
  });

  it('onBeforeRequest injects error notification', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    mgr.startTask('test-agent', 'risky query', async () => {
      throw new Error('fail');
    });
    await new Promise((r) => setTimeout(r, 10));

    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hi' },
    ];
    const result = plugin.onBeforeRequest!(messages);
    assert.ok(result[1].content!.includes('❌'));
    assert.ok(result[1].content!.includes('fail'));
  });

  it('onInit registers individual agent tool plugins', async () => {
    const plugin = createAgentCoordinatorPlugin(mockLLMClient());
    const registry = new PluginRegistry();
    await plugin.onInit!(registry);
    // Should not throw — no agents means nothing to register
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
