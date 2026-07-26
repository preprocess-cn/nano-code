import { describe, it } from 'vitest';
import * as assert from 'node:assert/strict';
import { AgentManager } from '../src/core/agent-manager.js';
import { LLMClient } from '../src/core/llm.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { InMemoryStore } from '../src/core/store.js';

function createManager(opts?: { maxAgents?: number }) {
  const llm = new LLMClient({ apiKey: 'test-key' });
  const store = new InMemoryStore();
  const manager = new AgentManager({ llmClient: llm, store, maxAgents: opts?.maxAgents });
  return { manager, llm, store };
}

describe('AgentManager', () => {
  it('starts with 0 agents', () => {
    const { manager } = createManager();
    assert.equal(manager.activeCount, 0);
    assert.deepEqual(manager.listAgents(), []);
  });

  it('createAgent adds an agent and returns it', () => {
    const { manager } = createManager();
    const agent = manager.createAgent({ name: 'test', registry: new PluginRegistry() });
    assert.equal(agent.getName(), 'test');
    assert.equal(manager.activeCount, 1);
    assert.equal(manager.listAgents().length, 1);
  });

  it('duplicate name gets suffixed _1, _2', () => {
    const { manager } = createManager();
    const reg = new PluginRegistry();
    const a0 = manager.createAgent({ name: 'dup', registry: reg });
    const a1 = manager.createAgent({ name: 'dup', registry: reg });
    const a2 = manager.createAgent({ name: 'dup', registry: reg });
    assert.equal(a0.getName(), 'dup');
    assert.equal(a1.getName(), 'dup_1');
    assert.equal(a2.getName(), 'dup_2');
  });

  it('removeAgent removes agent and its store keys', () => {
    const { manager } = createManager();
    const reg = new PluginRegistry();
    manager.createAgent({ name: 'rem', registry: reg });
    assert.equal(manager.activeCount, 1);
    manager.removeAgent('rem');
    assert.equal(manager.activeCount, 0);
    assert.equal(manager.getAgent('rem'), undefined);
    assert.equal(manager.getAgentInfo('rem'), undefined);
  });

  it('killAgent sets cancelled flag', () => {
    const { manager, store } = createManager();
    const ctrl = new AbortController();
    manager.createAgent({ name: 'victim', registry: new PluginRegistry(), abortController: ctrl });
    const ok = manager.killAgent('victim');
    assert.equal(ok, true);
    assert.equal(store.get<boolean>('agent:cancelled:victim'), true);
  });

  it('killAgent on nonexistent agent returns false', () => {
    const { manager } = createManager();
    assert.equal(manager.killAgent('ghost'), false);
  });

  it('getAgentInfo returns info for created agent', () => {
    const { manager } = createManager();
    manager.createAgent({ name: 'info-test', registry: new PluginRegistry() });
    const info = manager.getAgentInfo('info-test');
    assert.ok(info);
    assert.equal(info!.name, 'info-test');
    assert.equal(info!.status, 'idle');
    assert.equal(typeof info!.createdAt, 'string');
  });

  it('throws when exceeding maxAgents', () => {
    const { manager } = createManager({ maxAgents: 2 });
    const reg = new PluginRegistry();
    manager.createAgent({ name: 'a', registry: reg });
    manager.createAgent({ name: 'b', registry: reg });
    assert.throws(() => manager.createAgent({ name: 'c', registry: reg }), {
      message: /Agent 数量已达上限/,
    });
  });

  it('getStore returns the injected store', () => {
    const { manager, store } = createManager();
    assert.equal(manager.getStore(), store);
  });

  it('getLLMClient returns the injected client', () => {
    const { manager, llm } = createManager();
    assert.equal(manager.getLLMClient(), llm);
  });

  it('updateAgentStatus propagates to store', () => {
    const { manager, store } = createManager();
    manager.createAgent({ name: 'status-test', registry: new PluginRegistry() });
    manager.updateAgentStatus('status-test', 'running', 5);
    const v = store.get<{ agentName: string; status: string; messageCount: number }>('agent:status:status-test');
    assert.equal(v?.status, 'running');
  });
});
