import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { IStore } from '../src/store.js';
import { InMemoryStore } from '../src/plugins/store/in-memory.js';
import { PluginRegistry } from '../src/plugin.js';

describe('InMemoryStore', () => {

  function createStore(): IStore {
    return new InMemoryStore();
  }

  it('get returns undefined for unknown key', () => {
    const s = createStore();
    assert.equal(s.get('unknown'), undefined);
  });

  it('set then get returns the value', () => {
    const s = createStore();
    s.set('key1', { a: 1 });
    assert.deepEqual(s.get('key1'), { a: 1 });
  });

  it('set overwrites previous value', () => {
    const s = createStore();
    s.set('key', 'old');
    s.set('key', 'new');
    assert.equal(s.get('key'), 'new');
  });

  it('subscribe fires on set', () => {
    const s = createStore();
    const seen: string[] = [];
    s.subscribe('key', () => seen.push('called'));
    s.set('key', 'value');
    assert.deepEqual(seen, ['called']);
  });

  it('subscribe does not fire for different key', () => {
    const s = createStore();
    let called = false;
    s.subscribe('key', () => { called = true; });
    s.set('other', 'value');
    assert.equal(called, false);
  });

  it('unsubscribe stops notifications', () => {
    const s = createStore();
    let count = 0;
    const unsub = s.subscribe('key', () => count++);
    s.set('key', 1);
    unsub();
    s.set('key', 2);
    assert.equal(count, 1);
  });

  it('multiple subscribers all fire', () => {
    const s = createStore();
    let a = 0, b = 0;
    s.subscribe('key', () => a++);
    s.subscribe('key', () => b++);
    s.set('key', 'v');
    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  it('subscribe with no prior set works', () => {
    const s = createStore();
    let called = false;
    s.subscribe('key', () => { called = true; });
    s.set('key', 1);
    assert.equal(called, true);
  });

});

describe('IStore interface', () => {

  it('PluginRegistry.store satisfies IStore contract', () => {
    const r = new PluginRegistry();
    const store: IStore = r.store;
    assert.ok(store);
    store.set('test', 42);
    assert.equal(store.get('test'), 42);
  });

});
