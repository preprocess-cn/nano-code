import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CronScheduler } from '../src/plugins/cron/cron-scheduler.js';
import { cronPlugin } from '../src/plugins/cron/cron-plugin.js';
import { ChatMessage } from '../src/core/llm.js';

describe('CronPlugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    CronScheduler.resetInstance();
    const scheduler = CronScheduler.getInstance();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-plugin-test-'));
    (scheduler as any).persistencePath = path.join(tmpDir, 'cron-tasks.json');
    (scheduler as any)._initialized = true;
  });

  afterEach(() => {
    CronScheduler.getInstance().cancelAll();
    CronScheduler.resetInstance();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('getTools returns 3 tool definitions', () => {
    const tools = cronPlugin.getTools();
    assert.equal(tools.length, 3);
    const names = tools.map(t => t.function.name);
    assert.ok(names.includes('cron_create'));
    assert.ok(names.includes('cron_delete'));
    assert.ok(names.includes('cron_list'));
  });

  it('cron_create creates a task', async () => {
    const result = await cronPlugin.execute('cron_create', {
      cron: '*/5 * * * *',
      prompt: 'test',
      recurring: true,
      durable: false,
    }, {} as any);
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.ok(data.id);
    assert.equal(data.prompt, 'test');
    assert.equal(data.recurring, true);
    assert.equal(data.durable, false);
  });

  it('cron_create rejects invalid cron', async () => {
    const result = await cronPlugin.execute('cron_create', {
      cron: 'bad-cron',
      prompt: 'test',
      recurring: true,
      durable: false,
    }, {} as any);
    assert.equal(result.status, 'error');
  });

  it('cron_delete removes a task', async () => {
    const created = await cronPlugin.execute('cron_create', {
      cron: '*/5 * * * *', prompt: 'delete me', recurring: true, durable: false,
    }, {} as any);
    assert.equal(created.status, 'success');
    const data = JSON.parse(created.data!);

    const deleted = await cronPlugin.execute('cron_delete', { id: data.id }, {} as any);
    assert.equal(deleted.status, 'success');
  });

  it('cron_delete returns error for non-existent task', async () => {
    const result = await cronPlugin.execute('cron_delete', { id: 'cron_999' }, {} as any);
    assert.equal(result.status, 'error');
  });

  it('cron_list returns empty list initially', async () => {
    const result = await cronPlugin.execute('cron_list', {}, {} as any);
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.count, 0);
  });

  it('cron_list returns created tasks', async () => {
    await cronPlugin.execute('cron_create', {
      cron: '*/5 * * * *', prompt: 'task1', recurring: true, durable: false,
    }, {} as any);
    await cronPlugin.execute('cron_create', {
      cron: '0 */1 * * *', prompt: 'task2', recurring: true, durable: false,
    }, {} as any);

    const result = await cronPlugin.execute('cron_list', {}, {} as any);
    const data = JSON.parse(result.data!);
    assert.equal(data.count, 2);
  });

  it('onBeforeRequest injects fired messages', async () => {
    const scheduler = CronScheduler.getInstance();
    const task = scheduler.createTask({
      cron: '*/5 * * * *', prompt: 'fired prompt!', recurring: false, durable: false,
    });
    assert.ok(!('error' in task));

    // Simulate fire
    (scheduler as any).onFire(task);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user message' },
    ];
    const result = cronPlugin.onBeforeRequest!(messages);
    assert.equal(result.length, 3);
    assert.equal(result[2].role, 'user');    // isMeta 追加在末尾
    assert.equal(result[2].isMeta, true);
    assert.ok(result[2].content!.includes('fired prompt!'));
  });

  it('onBeforeRequest returns unchanged when no fired tasks', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
    ];
    const result = cronPlugin.onBeforeRequest!(messages);
    assert.equal(result.length, 1);
    assert.equal(result[0], messages[0]); // same reference
  });

  it('onBeforeRequest appends isMeta messages at the end', async () => {
    const scheduler = CronScheduler.getInstance();
    const task = scheduler.createTask({
      cron: '*/5 * * * *', prompt: 'check status', recurring: false, durable: false,
    });
    assert.ok(!('error' in task));
    (scheduler as any).onFire(task);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user msg 1' },
      { role: 'assistant', content: 'response' },
    ];
    const result = cronPlugin.onBeforeRequest!(messages);
    assert.equal(result.length, 4);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');       // 原文不变
    assert.equal(result[1].content, 'user msg 1');
    assert.equal(result[2].role, 'assistant');   // 原文不变
    assert.equal(result[2].content, 'response');
    assert.equal(result[3].role, 'user');        // isMeta 追加在末尾
    assert.equal(result[3].isMeta, true);
  });

  it('onAfterRequest clears injectedSinceFire', () => {
    const scheduler = CronScheduler.getInstance();
    const task = scheduler.createTask({
      cron: '*/5 * * * *', prompt: 'after test', recurring: true, durable: false,
    });
    assert.ok(!('error' in task));
    (scheduler as any).onFire(task);
    scheduler.drainFired();

    // After clearing, next fire should be injectable
    cronPlugin.onAfterRequest!({ text: null } as any);

    (scheduler as any).onFire(task);
    const fired = scheduler.drainFired();
    assert.equal(fired.length, 1);
  });

  it('handles unknown tool name', async () => {
    const result = await cronPlugin.execute('unknown_tool', {}, {} as any);
    assert.equal(result.status, 'error');
  });

  it('cron_create with durable=true persists task', async () => {
    await cronPlugin.execute('cron_create', {
      cron: '*/5 * * * *', prompt: 'persist me', recurring: true, durable: true,
    }, {} as any);

    // Simulate restart
    CronScheduler.getInstance().cancelAll();
    CronScheduler.resetInstance();
    const newScheduler = CronScheduler.getInstance();
    (newScheduler as any).persistencePath = path.join(tmpDir, 'cron-tasks.json');
    (newScheduler as any)._initialized = false;
    newScheduler.initialize();

    assert.equal(newScheduler.listTasks().length, 1);
    assert.equal(newScheduler.listTasks()[0].prompt, 'persist me');
  });
});
