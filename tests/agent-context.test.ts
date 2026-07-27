import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createMainContext,
  createSubagentContext,
  StreamingTextManager,
} from '../src/plugins/display/claude-code-ink/agent-context.js';

function mockStore(): any {
  const data = new Map<string, any>();
  return {
    get: (key: string) => data.get(key),
    set: (key: string, value: any) => { data.set(key, value); },
    subscribe: () => () => {},
  };
}

describe('StreamingTextManager', () => {
  it('starts with null', () => {
    const m = new StreamingTextManager();
    assert.equal(m.get(), null);
  });

  it('accumulates text via functional updater', () => {
    const m = new StreamingTextManager();
    m.update(prev => (prev ?? '') + 'Hello');
    m.update(prev => (prev ?? '') + ' world');
    assert.equal(m.get(), 'Hello world');
  });

  it('resets to null', () => {
    const m = new StreamingTextManager();
    m.update(() => 'text');
    m.reset();
    assert.equal(m.get(), null);
  });

  it('clears via null updater', () => {
    const m = new StreamingTextManager();
    m.update(() => 'text');
    m.update(() => null);
    assert.equal(m.get(), null);
  });

  it('handles empty string accumulation', () => {
    const m = new StreamingTextManager();
    m.update(prev => (prev ?? '') + '');
    assert.equal(m.get(), '');
  });
});

describe('createSubagentContext', () => {
  it('creates isolated context from parent', () => {
    const store = mockStore();
    const parent = createMainContext(store);

    const child = createSubagentContext(parent, {
      agentName: 'explore_1',
      agentType: 'Explore',
    });

    // 基本字段
    assert.equal(child.agentName, 'explore_1');
    assert.equal(child.agentType, 'Explore');
    assert.equal(child.parentContext, parent);

    // 子 context 有自己的 streamingText
    child.streamingText.update(() => 'child text');
    assert.equal(child.streamingText.get(), 'child text');
    // 父 context 不受影响
    assert.equal(parent.streamingText.get(), null);

    // 共享 store
    assert.equal(child.store, parent.store);

    // 共享 setResponseLength：需在创建子 context 前设置 parent 的回调
    // （createSubagentContext 按值捕获 parent.setResponseLength）
    let parentResponseLen = 0;
    parent.setResponseLength = (f) => { parentResponseLen = f(parentResponseLen); };
    const child2 = createSubagentContext(parent, {
      agentName: 'explore_2',
      agentType: 'Explore',
    });
    child2.setResponseLength(prev => prev + 100);
    assert.equal(parentResponseLen, 100);

    // 独立的 abortController
    assert.notEqual(child.abortController, parent.abortController);

    // 有自己的 messages（独立数组）
    assert.notEqual(child.messages, parent.messages);
    child.messages.push({ agentName: 'explore_1', text: 'test', kind: 'info' });
    assert.equal(child.messages.length, 1);
    assert.equal(parent.messages.length, 0);
  });

  it('defaults isAsync to true for sub-agents', () => {
    const store = mockStore();
    const parent = createMainContext(store);
    const child = createSubagentContext(parent, {
      agentName: 'bg_1',
      agentType: 'Background',
    });
    assert.equal(child.isAsync, true);
  });

  it('allows overriding isAsync and abortController', () => {
    const store = mockStore();
    const parent = createMainContext(store);
    const ctrl = new AbortController();
    const child = createSubagentContext(parent, {
      agentName: 'sync_1',
      agentType: 'SyncAgent',
      isAsync: false,
      abortController: ctrl,
    });
    assert.equal(child.isAsync, false);
    assert.equal(child.abortController, ctrl);
  });

  it('handles multiple levels of nesting', () => {
    const store = mockStore();
    const main = createMainContext(store);
    const child = createSubagentContext(main, {
      agentName: 'explore_1',
      agentType: 'Explore',
    });
    const grandchild = createSubagentContext(child, {
      agentName: 'read_1',
      agentType: 'Read',
    });

    // 所有层级共享 store
    assert.equal(grandchild.store, store);
    // 各自有独立的 streamingText
    grandchild.streamingText.update(() => 'grandchild');
    assert.equal(grandchild.streamingText.get(), 'grandchild');
    assert.equal(child.streamingText.get(), null);
    assert.equal(main.streamingText.get(), null);
  });
});
