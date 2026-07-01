import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { BackgroundTaskManager } from '../src/plugins/coordinator/task-manager.js';
import { AgentLifecycle } from '../src/plugins/coordinator/lifecycle.js';

describe('BackgroundTaskManager', () => {
  afterEach(() => {
    BackgroundTaskManager.resetInstance();
    AgentLifecycle.resetInstance();
  });

  it('returns the same singleton instance', () => {
    const a = BackgroundTaskManager.getInstance();
    const b = BackgroundTaskManager.getInstance();
    assert.equal(a, b);
  });

  it('startTask returns a taskId string', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test-agent', 'do something', async () => 'ok');
    assert.ok(id.startsWith('task_'));
  });

  it('startTask begins with status running', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test-agent', 'do something', async () => 'ok');
    const task = mgr.getTask(id);
    assert.equal(task?.status, 'running');
    assert.equal(task?.agentName, 'test-agent');
    assert.equal(task?.query, 'do something');
  });

  it('getTask returns correct task info', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('agent-a', 'query-a', async () => 'result-a');
    const task = mgr.getTask(id);
    assert.equal(task?.taskId, id);
    assert.equal(task?.agentName, 'agent-a');
    assert.equal(task?.query, 'query-a');
  });

  it('getTask returns undefined for unknown ID', () => {
    const mgr = BackgroundTaskManager.getInstance();
    assert.equal(mgr.getTask('nonexistent'), undefined);
  });

  it('after runner completes, status transitions to completed', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'work', async () => 'done');
    // Wait for the runner microtask
    await new Promise((r) => setTimeout(r, 10));
    const task = mgr.getTask(id);
    assert.equal(task?.status, 'completed');
    assert.equal(task?.result, 'done');
    assert.ok(task?.completedAt);
  });

  it('getCompletedTasks drains the queue', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    mgr.startTask('test', 'work', async () => 'done');
    await new Promise((r) => setTimeout(r, 10));

    const first = mgr.getCompletedTasks();
    assert.equal(first.length, 1);

    const second = mgr.getCompletedTasks();
    assert.equal(second.length, 0);
  });

  it('after runner throws, status transitions to error', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'work', async () => {
      throw new Error('something broke');
    });
    await new Promise((r) => setTimeout(r, 10));
    const task = mgr.getTask(id);
    assert.equal(task?.status, 'error');
    assert.equal(task?.error, 'something broke');
  });

  it('cancelTask marks running task as error', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'work', () => new Promise(() => {})); // never resolves
    const cancelled = mgr.cancelTask(id);
    assert.equal(cancelled, true);
    const task = mgr.getTask(id);
    assert.equal(task?.status, 'error');
    assert.equal(task?.error, 'cancelled');
  });

  it('cancelTask on completed task returns false', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'work', async () => 'done');
    await new Promise((r) => setTimeout(r, 10));
    const cancelled = mgr.cancelTask(id);
    assert.equal(cancelled, false);
  });

  it('listTasks returns all tasks including running and completed', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    mgr.startTask('a', 'q1', () => new Promise(() => {})); // stays running
    mgr.startTask('b', 'q2', async () => 'done');
    await new Promise((r) => setTimeout(r, 10));

    const all = mgr.listTasks();
    assert.equal(all.length, 2);
  });

  it('multiple concurrent tasks complete independently', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id1 = mgr.startTask('a', 'q1', async () => 'r1');
    const id2 = mgr.startTask('b', 'q2', async () => 'r2');
    const id3 = mgr.startTask('c', 'q3', async () => {
      throw new Error('fail');
    });

    await new Promise((r) => setTimeout(r, 10));

    assert.equal(mgr.getTask(id1)?.status, 'completed');
    assert.equal(mgr.getTask(id2)?.status, 'completed');
    assert.equal(mgr.getTask(id3)?.status, 'error');
  });

  it('getCompletedTasks removes entries from tasks Map', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'work', async () => 'done');
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(mgr.getTask(id), 'task should be in map before drain');
    mgr.getCompletedTasks();
    assert.equal(mgr.getTask(id), undefined, 'task should be removed from map after drain');
  });

  it('cancelTask after runner completes returns false and does not double-push', async () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'quick', async () => 'done');
    await new Promise((r) => setTimeout(r, 10));

    const cancelled = mgr.cancelTask(id);
    assert.equal(cancelled, false);

    // Should only appear once in completed queue
    const completed = mgr.getCompletedTasks();
    assert.equal(completed.length, 1);
  });

  it('cancelTask aborts AgentLifecycle controller', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const lifecycle = AgentLifecycle.getInstance();

    // Register controller in lifecycle with the taskId that startTask will generate
    const id = mgr.startTask('test', 'running', () => new Promise(() => {}));
    const controller = lifecycle.createTaskController(id);
    assert.equal(controller.signal.aborted, false);

    mgr.cancelTask(id);
    assert.equal(controller.signal.aborted, true);
    assert.equal(mgr.getTask(id)?.status, 'error');
  });

  it('runner .then() does not double-push when cancelTask fires first', () => {
    const mgr = BackgroundTaskManager.getInstance();
    const id = mgr.startTask('test', 'slow', () => new Promise(() => {})); // never resolves

    mgr.cancelTask(id);
    // Let the (non-existent) microtasks settle
    const completed = mgr.getCompletedTasks();
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'error');
  });
});
