import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgentToolPlugin } from '../src/plugins/coordinator/agent-tool.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { AgentDefinition } from '../src/core/agent-loader.js';
import { LLMClient } from '../src/core/llm.js';
import { BackgroundTaskManager } from '../src/plugins/coordinator/task-manager.js';
import { MessageBus } from '../src/plugins/coordinator/message-bus.js';
import { AgentLifecycle } from '../src/plugins/coordinator/lifecycle.js';

function mockLLMClient() {
  return {
    model: 'test-model',
    temperature: 0,
  } as unknown as LLMClient;
}

describe('createAgentToolPlugin', () => {

  afterEach(() => {
    BackgroundTaskManager.resetInstance();
    MessageBus.resetInstance();
    AgentLifecycle.resetInstance();
  });

  const baseDef: AgentDefinition = {
    name: 'test-agent',
    description: 'A test agent for unit testing',
    role: 'You are a test agent',
  };

  it('returns a plugin with the correct name', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    assert.equal(plugin.name, 'agent:test-agent');
    assert.equal(plugin.description, 'A test agent for unit testing');
  });

  it('exposes a single tool named agent-<name>', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const tools = plugin.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'agent-test-agent');
  });

  it('tool has query parameter', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const tools = plugin.getTools();
    const params = tools[0].function.parameters;
    assert.ok(params.properties.query, 'should have query property');
    assert.equal(params.required[0], 'query');
  });

  it('can be registered in a PluginRegistry', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const registry = new PluginRegistry();
    await registry.register(plugin);

    const schemas = registry.getAllSchemas();
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].function.name, 'agent-test-agent');
  });

  it('returns error when query is empty', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const result = await plugin.execute('agent-test-agent', {}, {
      skipPermission: true,
      cwd: process.cwd(),
      defaultTimeout: 30000,
      sideEffect: false,
    });

    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('query'));
  });

  it('tool has sideEffect: false', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const tools = plugin.getTools();
    assert.equal(tools[0].function.sideEffect, false);
  });

  it('tool has run_in_background parameter', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const params = plugin.getTools()[0].function.parameters.properties;
    assert.ok(params.run_in_background, 'should have run_in_background property');
    assert.equal(params.run_in_background.type, 'boolean');
  });

  it('background execution returns success with taskId', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const result = await plugin.execute('agent-test-agent', {
      query: 'do something',
      run_in_background: true,
    }, {
      skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false,
    });

    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.ok(data.taskId);
    assert.equal(data.status, 'started');
    assert.equal(data.agentName, 'test-agent');
  });

  it('background execution starts a task in BackgroundTaskManager', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    await plugin.execute('agent-test-agent', {
      query: 'test work',
      run_in_background: true,
    }, {
      skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false,
    });

    const mgr = BackgroundTaskManager.getInstance();
    const tasks = mgr.listTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agentName, 'test-agent');
    assert.equal(tasks[0].query, 'test work');
    assert.equal(tasks[0].status, 'running');
  });

  it('background execution registers agent in MessageBus', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    await plugin.execute('agent-test-agent', {
      query: 'do work',
      run_in_background: true,
    }, {
      skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false,
    });

    const mgr = BackgroundTaskManager.getInstance();
    const taskId = mgr.listTasks()[0]?.taskId;
    assert.ok(taskId);

    const bus = MessageBus.getInstance();
    assert.equal(bus.resolveRecipient('test-agent'), taskId);
  });

  it('AgentLifecycle cancelTask aborts the task controller', () => {
    const lifecycle = AgentLifecycle.getInstance();
    const controller = lifecycle.createTaskController('test-cancel');
    assert.equal(controller.signal.aborted, false);

    const cancelled = lifecycle.cancelTask('test-cancel');
    assert.equal(cancelled, true);
    assert.equal(controller.signal.aborted, true);
  });

  it('cancelTask on unknown taskId returns false', () => {
    const lifecycle = AgentLifecycle.getInstance();
    assert.equal(lifecycle.cancelTask('nonexistent'), false);
  });

  it('cancelTask on already cancelled taskId returns false', () => {
    const lifecycle = AgentLifecycle.getInstance();
    lifecycle.createTaskController('test-already');
    lifecycle.cancelTask('test-already');
    assert.equal(lifecycle.cancelTask('test-already'), false);
  });

  it('background execution unregisters agent from MessageBus on completion', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    await plugin.execute('agent-test-agent', {
      query: 'quick work',
      run_in_background: true,
    }, {
      skipPermission: true, cwd: process.cwd(), defaultTimeout: 30000, sideEffect: false,
    });

    // Wait for the runner to complete (it will try to call LLM which will throw,
    // but the runner's finally block unregisters regardless)
    await new Promise((r) => setTimeout(r, 50));

    const bus = MessageBus.getInstance();
    assert.equal(bus.resolveRecipient('test-agent'), undefined);
  });

});
