import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SK } from '../src/core/store-keys.js';

describe('SK constants', () => {
  test('all keys have correct string values', () => {
    assert.equal(SK.AgentStatus, 'agent');
    assert.equal(SK.AgentCancelled, 'agent:cancelled');
    assert.equal(SK.AgentAbort, 'agent:abort');
    assert.equal(SK.AgentMessages, 'agent:messages');
    assert.equal(SK.CompactResult, 'compact:result');
    assert.equal(SK.CompactSignal, 'compact:signal');
    assert.equal(SK.CompactCompleted, 'compact:completed');
    assert.equal(SK.CompactRetry, 'compact:retry');
    assert.equal(SK.TokenBudgetInitialAccumulated, 'token-budget:initialAccumulated');
    assert.equal(SK.TokenBudgetGetApiUsage, 'token-budget:getApiUsage');
    assert.equal(SK.FsReadCache, 'fs:readCache');
    assert.equal(SK.Mode, 'task-plan:mode');
    assert.equal(SK.PlanContent, 'task-plan:planContent');
    assert.equal(SK.Tasks, 'task-plan:tasks');
    assert.equal(SK.TaskCount, 'task-plan:taskCount');
  });

  test('every SK value is a non-empty string', () => {
    for (const [k, v] of Object.entries(SK)) {
      assert.equal(typeof v, 'string', `SK.${k} must be a string`);
      assert.ok(v.length > 0, `SK.${k} must not be empty`);
    }
  });

  test('all SK values are unique', () => {
    const values = Object.values(SK);
    const unique = new Set(values);
    assert.equal(values.length, unique.size, 'Each SK key must have a unique string value');
  });
});

describe('IStore direct usage', () => {
  function createStore() {
    const map = new Map<string, unknown>();
    return {
      get<T>(key: string): T | undefined { return map.get(key) as T | undefined; },
      set<T>(key: string, value: unknown): void { map.set(key, value as T); },
      subscribe(): () => void { return () => {}; },
    };
  }

  test('store.get/set round-trip with SK keys', () => {
    const store = createStore();
    store.set(SK.AgentStatus, { agentName: 'main', status: 'running', messageCount: 5 });
    const status = store.get<{ agentName: string; status: string; messageCount: number }>(SK.AgentStatus);
    assert.deepEqual(status, { agentName: 'main', status: 'running', messageCount: 5 });
  });

  test('store.get returns undefined for unset keys', () => {
    const store = createStore();
    assert.equal(store.get(SK.AgentCancelled), undefined);
  });

  test('store.set with boolean key', () => {
    const store = createStore();
    store.set(SK.CompactCompleted, true);
    assert.equal(store.get<boolean>(SK.CompactCompleted), true);
  });

  test('store.set with string key', () => {
    const store = createStore();
    store.set(SK.Mode, 'plan');
    assert.equal(store.get<string>(SK.Mode), 'plan');
    store.set(SK.Mode, 'normal');
    assert.equal(store.get<string>(SK.Mode), 'normal');
  });

  test('store.set with number key', () => {
    const store = createStore();
    store.set(SK.TaskCount, 3);
    assert.equal(store.get<number>(SK.TaskCount), 3);
  });

  test('store.set with object key', () => {
    const store = createStore();
    store.set(SK.AgentStatus, { agentName: 'main', status: 'idle', messageCount: 10 });
    assert.deepEqual(store.get(SK.AgentStatus), { agentName: 'main', status: 'idle', messageCount: 10 });
  });

  test('arbitrary string keys work', () => {
    const store = createStore();
    store.set('custom:key', 42);
    assert.equal(store.get<number>('custom:key'), 42);
  });

  test('round-trip multiple keys preserves values', () => {
    const store = createStore();
    store.set(SK.AgentStatus, { agentName: 'worker', status: 'running', messageCount: 1 });
    store.set(SK.Mode, 'plan');
    store.set(SK.TaskCount, 5);

    assert.deepEqual(store.get(SK.AgentStatus), { agentName: 'worker', status: 'running', messageCount: 1 });
    assert.equal(store.get<string>(SK.Mode), 'plan');
    assert.equal(store.get<number>(SK.TaskCount), 5);
  });
});
