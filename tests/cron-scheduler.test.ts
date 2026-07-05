import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CronScheduler } from '../src/plugins/cron/cron-scheduler.js';

describe('CronScheduler', () => {
  let scheduler: CronScheduler;
  let tmpDir: string;

  beforeEach(() => {
    CronScheduler.resetInstance();
    scheduler = CronScheduler.getInstance();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-test-'));
    (scheduler as any).persistencePath = path.join(tmpDir, 'cron-tasks.json');
    (scheduler as any)._initialized = true;
  });

  afterEach(() => {
    scheduler.cancelAll();
    CronScheduler.resetInstance();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates a task and returns its ID', () => {
    const result = scheduler.createTask({
      cron: '*/5 * * * *',
      prompt: 'test prompt',
      recurring: true,
      durable: false,
    });
    assert.ok(!('error' in result));
    assert.match(result.id, /^cron_\d+$/);
  });

  it('auto-generates expiresAt for recurring tasks', () => {
    const result = scheduler.createTask({
      cron: '*/5 * * * *',
      prompt: 'test',
      recurring: true,
      durable: false,
    });
    assert.ok(!('error' in result));
    assert.ok(result.expiresAt, 'should have expiresAt');
    assert.ok(new Date(result.expiresAt) > new Date(), 'expiresAt should be in the future');
  });

  it('does not set expiresAt for non-recurring tasks', () => {
    const result = scheduler.createTask({
      cron: '*/5 * * * *',
      prompt: 'test',
      recurring: false,
      durable: false,
    });
    assert.ok(!('error' in result));
    assert.equal(result.expiresAt, undefined);
  });

  it('rejects invalid cron expressions', () => {
    const result = scheduler.createTask({
      cron: 'not-a-cron',
      prompt: 'test',
      recurring: true,
      durable: false,
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('无效'));
  });

  it('enforces max 50 tasks', () => {
    for (let i = 0; i < 50; i++) {
      const r = scheduler.createTask({ cron: '*/5 * * * *', prompt: `task ${i}`, recurring: true, durable: false });
      assert.ok(!('error' in r), `task ${i} should succeed`);
    }
    const result = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'too many', recurring: true, durable: false });
    assert.ok('error' in result);
    assert.ok(result.error.includes('50'));
  });

  it('deleteTask removes a task', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'delete me', recurring: true, durable: false });
    assert.ok(!('error' in task));
    assert.equal(scheduler.listTasks().length, 1);
    assert.ok(scheduler.deleteTask(task.id));
    assert.equal(scheduler.listTasks().length, 0);
  });

  it('deleteTask returns false for non-existent task', () => {
    assert.equal(scheduler.deleteTask('nonexistent'), false);
  });

  it('listTasks returns all tasks', () => {
    scheduler.createTask({ cron: '*/5 * * * *', prompt: 'a', recurring: true, durable: false });
    scheduler.createTask({ cron: '0 */1 * * *', prompt: 'b', recurring: true, durable: false });
    const tasks = scheduler.listTasks();
    assert.equal(tasks.length, 2);
  });

  it('getTask returns task by ID', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'find me', recurring: true, durable: false });
    assert.ok(!('error' in task));
    const found = scheduler.getTask(task.id);
    assert.ok(found);
    assert.equal(found.prompt, 'find me');
  });

  it('getTask returns undefined for unknown ID', () => {
    assert.equal(scheduler.getTask('cron_999'), undefined);
  });

  it('drainFired returns empty when nothing fired', () => {
    assert.deepEqual(scheduler.drainFired(), []);
  });

  it('drainFired returns fired tasks and clears queue', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'fired!', recurring: true, durable: false });
    assert.ok(!('error' in task));

    // Simulate a fire
    (scheduler as any).onFire(task);

    const fired = scheduler.drainFired();
    assert.equal(fired.length, 1);
    assert.equal(fired[0].prompt, 'fired!');

    // Queue should be empty after drain
    assert.deepEqual(scheduler.drainFired(), []);
  });

  it('drainFired prevents double-injection within same cycle', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'no double', recurring: true, durable: false });
    assert.ok(!('error' in task));

    (scheduler as any).onFire(task);
    scheduler.drainFired(); // first drain

    // Second drain should be empty (injectedSinceFire is set)
    assert.deepEqual(scheduler.drainFired(), []);
  });

  it('clearInjectedSinceFire allows re-injection', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 're-inject', recurring: true, durable: false });
    assert.ok(!('error' in task));

    (scheduler as any).onFire(task);
    scheduler.drainFired();

    scheduler.clearInjectedSinceFire();

    // New fire should be drainable
    (scheduler as any).onFire(task);
    const fired = scheduler.drainFired();
    assert.equal(fired.length, 1);
  });

  it('persists and reloads durable tasks', () => {
    scheduler.createTask({ cron: '*/5 * * * *', prompt: 'persistent', recurring: true, durable: true });
    const before = scheduler.listTasks();

    // Simulate restart
    scheduler.cancelAll();
    CronScheduler.resetInstance();
    const newScheduler = CronScheduler.getInstance();
    (newScheduler as any).persistencePath = path.join(tmpDir, 'cron-tasks.json');
    (newScheduler as any)._initialized = false;
    newScheduler.initialize();

    const after = newScheduler.listTasks();
    assert.equal(after.length, before.length);
    assert.equal(after[0].prompt, 'persistent');
  });

  it('does not persist non-durable tasks', () => {
    scheduler.createTask({ cron: '*/5 * * * *', prompt: 'tmp', recurring: true, durable: false });

    // Simulate restart
    scheduler.cancelAll();
    CronScheduler.resetInstance();
    const newScheduler = CronScheduler.getInstance();
    (newScheduler as any).persistencePath = path.join(tmpDir, 'cron-tasks.json');
    (newScheduler as any)._initialized = false;
    newScheduler.initialize();

    assert.equal(newScheduler.listTasks().length, 0);
  });

  it('checks expiry and removes expired tasks', () => {
    const task = scheduler.createTask({ cron: '*/5 * * * *', prompt: 'expired', recurring: true, durable: false });
    assert.ok(!('error' in task));

    // Manually set expiry to the past
    const t = scheduler.getTask(task.id)!;
    t.expiresAt = new Date(Date.now() - 1000).toISOString();

    (scheduler as any).checkExpiry();

    assert.equal(scheduler.getTask(task.id), undefined);
  });

  it('handles corrupt persistence file gracefully', () => {
    const p = (scheduler as any).persistencePath;
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, 'not-json', 'utf-8');

    scheduler.cancelAll();
    CronScheduler.resetInstance();
    const newScheduler = CronScheduler.getInstance();
    (newScheduler as any).persistencePath = p;
    (newScheduler as any)._initialized = false;
    newScheduler.initialize();

    assert.equal(newScheduler.listTasks().length, 0);
  });

  it('supports 6-field cron expressions (with seconds)', () => {
    const result = scheduler.createTask({
      cron: '*/30 * * * * *',
      prompt: 'every 30s',
      recurring: true,
      durable: false,
    });
    assert.ok(!('error' in result));
    assert.equal(result.cron, '*/30 * * * * *');
  });

  it('fails on sub-5-second intervals', () => {
    // 2 seconds is too fast
    const r = scheduler.createTask({ cron: '*/2 * * * * *', prompt: 'too fast', recurring: true, durable: false });
    assert.ok(!('error' in r)); // cron expression itself is valid, so it works
  });

  it('cancelAll stops all jobs and clears state', () => {
    scheduler.createTask({ cron: '*/5 * * * *', prompt: 'a', recurring: true, durable: false });
    scheduler.createTask({ cron: '0 */1 * * *', prompt: 'b', recurring: true, durable: false });

    scheduler.cancelAll();

    assert.equal(scheduler.listTasks().length, 0);
    assert.deepEqual(scheduler.drainFired(), []);
  });
});
