import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { MessageBus } from '../src/agent-message-bus.js';

describe('MessageBus', () => {
  afterEach(() => {
    MessageBus.resetInstance();
  });

  it('returns the same singleton instance', () => {
    const a = MessageBus.getInstance();
    const b = MessageBus.getInstance();
    assert.equal(a, b);
  });

  it('registerAgent maps name to taskId', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    assert.equal(bus.resolveRecipient('dba'), 'task_1');
    assert.equal(bus.resolveRecipient('task_1'), 'task_1');
  });

  it('resolveRecipient returns undefined for unknown', () => {
    const bus = MessageBus.getInstance();
    assert.equal(bus.resolveRecipient('unknown'), undefined);
  });

  it('send stores message in recipient mailbox', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    const result = bus.send('main', 'main', 'dba', 'Need help', 'Can you analyze this?');
    assert.equal(result.status, 'success');
    assert.equal(bus.pendingCount('task_1'), 1);
  });

  it('receive drains mailbox', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    bus.send('main', 'main', 'dba', 'Hi', 'Hello');
    bus.send('main', 'main', 'dba', 'Hi2', 'World');

    const msgs = bus.receive('task_1');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].summary, 'Hi');
    assert.equal(msgs[1].summary, 'Hi2');
    assert.equal(bus.pendingCount('task_1'), 0);
  });

  it('peek views without draining', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    bus.send('main', 'main', 'dba', 'Test', 'Body');

    const msgs = bus.peek('task_1');
    assert.equal(msgs.length, 1);
    assert.equal(bus.pendingCount('task_1'), 1); // still there
  });

  it('unregisterAgent removes from registry', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    bus.unregisterAgent('task_1');
    assert.equal(bus.resolveRecipient('dba'), undefined);
    assert.equal(bus.resolveRecipient('task_1'), undefined);
  });

  it('unregisterAgent cleans up mailbox', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_1', 'dba');
    bus.send('main', 'main', 'dba', 'Msg', 'Content');
    bus.unregisterAgent('task_1');
    assert.equal(bus.pendingCount('task_1'), 0);
  });

  it('send to unregistered agent returns error', () => {
    const bus = MessageBus.getInstance();
    const result = bus.send('main', 'main', 'nonexistent', 'Hi', 'Body');
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('未找到'));
  });

  it('send by taskId works', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('task_42', 'debugger');
    const result = bus.send('main', 'main', 'task_42', 'Hey', 'There');
    assert.equal(result.status, 'success');
    assert.equal(bus.pendingCount('task_42'), 1);
  });

  it('multiple messages queued and drained', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('t1', 'agent-a');
    bus.registerAgent('t2', 'agent-b');

    bus.send('main', 'main', 'agent-a', 'A1', 'Content A1');
    bus.send('main', 'main', 'agent-b', 'B1', 'Content B1');
    bus.send('main', 'main', 'agent-a', 'A2', 'Content A2');

    assert.equal(bus.receive('t1').length, 2);
    assert.equal(bus.receive('t2').length, 1);
    assert.equal(bus.receive('t1').length, 0); // drained already
  });

  it('receiveUpTo caps at max and leaves rest', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('t1', 'agent-a');
    bus.send('main', 'main', 'agent-a', 'M1', 'Body1');
    bus.send('main', 'main', 'agent-a', 'M2', 'Body2');
    bus.send('main', 'main', 'agent-a', 'M3', 'Body3');

    const first = bus.receiveUpTo('t1', 2);
    assert.equal(first.length, 2);
    assert.equal(first[0].summary, 'M1');
    assert.equal(first[1].summary, 'M2');

    const rest = bus.receive('t1');
    assert.equal(rest.length, 1);
    assert.equal(rest[0].summary, 'M3');
  });

  it('receiveUpTo drains all when max >= available', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('t1', 'agent-a');
    bus.send('main', 'main', 'agent-a', 'M1', 'Body1');

    const result = bus.receiveUpTo('t1', 10);
    assert.equal(result.length, 1);
    assert.equal(bus.pendingCount('t1'), 0);
  });

  it('receiveUpTo on empty mailbox returns empty array', () => {
    const bus = MessageBus.getInstance();
    bus.registerAgent('t1', 'agent-a');
    assert.equal(bus.receiveUpTo('t1', 5).length, 0);
  });
});
