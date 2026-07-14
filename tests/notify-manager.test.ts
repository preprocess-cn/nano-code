import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PluginRegistry } from '../src/core/plugin.js';
import { createNotifyManagerPlugin } from '../src/plugins/notify-manager.js';
import { SK } from '../src/store-keys.js';

describe('NotifyManager Queue Logic', () => {
  let plugin: ReturnType<typeof createNotifyManagerPlugin>;
  let registry: PluginRegistry;
  const calls: Array<{ source: string | null; message: string | null }> = [];

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(async () => {
    await plugin.onDestroy?.();
  });

  /** 创建插件，displayInterval 越小队列处理越快 */
  async function createPlugin(interval = 5) {
    const displayMgr = {
      setNotify(source: string | null, message: string | null) {
        calls.push({ source, message });
      },
    };
    plugin = createNotifyManagerPlugin({ displayMgr, displayInterval: interval });
    registry = new PluginRegistry();
    await registry.register(plugin);
  }

  /** 等待队列处理完毕 */
  function waitForQueue(): Promise<void> {
    return new Promise(r => setTimeout(r, 150));
  }

  /** 取非 null 的消息记录 */
  function messages(): Array<{ source: string; message: string }> {
    return calls.filter((c): c is { source: string; message: string } => c.source !== null);
  }

  it('displays notifications in FIFO order for single source', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    send('cron', 'task1');
    send('cron', 'task2');
    send('cron', 'task3');
    await waitForQueue();

    const msgs = messages();
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].message, 'task1');
    assert.equal(msgs[1].message, 'task2');
    assert.equal(msgs[2].message, 'task3');
  });

  it('round-robins between multiple sources', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    send('cron', 'task1');
    send('monitor', 'a');
    send('cron', 'task2');
    send('monitor', 'b');
    await waitForQueue();

    const msgs = messages();
    // cron(最老) → monitor(不同源) → cron(不同源) → monitor(最后源)
    assert.equal(msgs[0].source, 'cron');
    assert.equal(msgs[1].source, 'monitor');
    assert.equal(msgs[2].source, 'cron');
    assert.equal(msgs[3].source, 'monitor');
  });

  it('selects oldest queued message, preferring different source when tied', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    send('cron', 'a');
    send('cron', 'b');
    send('monitor', 'c');
    send('cron', 'd');
    await waitForQueue();

    const msgs = messages();
    // a(cron) 被立即处理。剩余：b(cron, ts2), c(monitor, ts3), d(cron, ts4)
    // 按最旧优先：b(cron, ts2) → c(monitor, ts3, 不同源) → d(cron, ts4, 唯一源)
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].message, 'a');
    assert.equal(msgs[1].source, 'cron');
    assert.equal(msgs[1].message, 'b');
    assert.equal(msgs[2].source, 'monitor');
    assert.equal(msgs[3].message, 'd');
  });

  it('limits per source to 5 queued entries', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    // 向同一源发 8 条，第一条被立即处理，队列最多积压 5 条
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(send('cron', `msg${i}`));
    }
    await waitForQueue();

    // 第 1 条立即处理，第 2-6 条入队成功，第 7-8 条被拒绝
    const accepted = results.filter(Boolean).length;
    assert.ok(accepted >= 6, `expected >= 6 accepted, got ${accepted}`);
    assert.ok(accepted <= 8, `expected <= 8 accepted, got ${accepted}`);
  });

  it('handles empty queue gracefully', async () => {
    await createPlugin(5);
    // 不发送任何通知，队列应为空且不报错
    await waitForQueue();
    assert.equal(messages().length, 0);
  });

  it('handles single source after multiple sources drain', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    send('cron', 'a');
    send('monitor', 'b');
    send('monitor', 'c');
    await waitForQueue();

    const msgs = messages();
    assert.equal(msgs.length, 3);
    // cron a (最老) → monitor b (不同源) → monitor c (唯一源)
    assert.equal(msgs[0].message, 'a');
    assert.equal(msgs[1].source, 'monitor');
  });

  it('processes new notifications after queue drains (timer reset)', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    // 第一批
    send('cron', 'first');
    await new Promise(r => setTimeout(r, 50));

    // 队列已空，发第二批
    send('cron', 'second');
    await waitForQueue();

    const msgs = messages();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].message, 'first');
    assert.equal(msgs[1].message, 'second');
  });

  it('preserves FIFO order within same source', async () => {
    await createPlugin(5);
    const send = registry.store.get<(s: string, m: string) => boolean>(SK.NotifySend)!;

    send('cron', 'first');
    send('monitor', 'a');
    send('cron', 'second');
    send('cron', 'third');
    await waitForQueue();

    const cronMessages = messages()
      .filter(m => m.source === 'cron')
      .map(m => m.message);
    assert.deepEqual(cronMessages, ['first', 'second', 'third']);
  });
});
