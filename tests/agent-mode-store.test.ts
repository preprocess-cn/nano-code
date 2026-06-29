import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SK, type AgentModeInfo } from '../src/core/store-keys.js';

describe('AgentMode via Store (DisplayPlugin 接口稳定替代方案)', () => {
  function createMockStore() {
    const map = new Map<string, unknown>();
    return {
      get<T>(key: string): T | undefined { return map.get(key) as T | undefined; },
      set<T>(key: string, value: unknown): void { map.set(key, value); },
      subscribe(): () => void { return () => {}; },
    };
  }

  test('default AgentMode is undefined', () => {
    const store = createMockStore();
    const mode = store.get<AgentModeInfo>(SK.AgentMode);
    assert.equal(mode, undefined);
  });

  test('repl reads AgentMode from Store', () => {
    const store = createMockStore();
    // Simulate what agent-slash plugin writes
    store.set(SK.AgentMode, { name: 'dba', description: '数据库专家' });

    // Simulate what repl reads
    const agentMode = store.get<AgentModeInfo>(SK.AgentMode);
    assert.ok(agentMode !== null);
    assert.equal(agentMode!.name, 'dba');
    assert.equal(agentMode!.description, '数据库专家');
  });

  test('repl prompt prefix uses name from Store', () => {
    const store = createMockStore();
    store.set(SK.AgentMode, { name: 'reviewer', description: '代码审查' });

    const agentMode = store.get<AgentModeInfo>(SK.AgentMode);
    const prefix = agentMode ? `[${agentMode.name}]` : '';
    assert.equal(prefix, '[reviewer]');
  });

  test('ink display reads AgentMode from Store', () => {
    const store = createMockStore();
    store.set(SK.AgentMode, { name: 'helper', description: '助手' });

    const activeName = store.get<AgentModeInfo>(SK.AgentMode)?.name;
    assert.equal(activeName, 'helper');
  });

  test('resetting to main mode clears AgentMode in Store', () => {
    const store = createMockStore();
    // Switch to agent
    store.set(SK.AgentMode, { name: 'dba', description: '数据库专家' });
    assert.ok(store.get<AgentModeInfo>(SK.AgentMode) !== undefined);

    // Reset to main
    store.set(SK.AgentMode, undefined);
    assert.equal(store.get<AgentModeInfo>(SK.AgentMode), undefined);
  });

  test('store.get/set typed round-trip with AgentMode', () => {
    const store = createMockStore();
    store.set(SK.AgentMode, { name: 'test', description: 'test agent' });
    const result = store.get<AgentModeInfo>(SK.AgentMode);
    assert.deepEqual(result, { name: 'test', description: 'test agent' });
  });
});
