import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { enqueue, enqueuePendingNotification, requestExit, hasPending, clear, reset, wait } from '../src/core/message-queue.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { SK } from '../src/core/store-keys.js';

/**
 * 永不 resolve 的 prompt mock，模拟 Ink display 的行为。
 * 实际输入通过 enqueue 进入，prompt 仅作为兜底 fallback。
 */
function neverPrompt() {
  return new Promise<string | null>(() => {});
}

describe('message-queue', () => {

  beforeEach(() => {
    reset();
  });

  describe('enqueue / wait', () => {

    it('enqueue 后 wait 立即返回积压项', async () => {
      enqueue({ mode: 'prompt', value: 'hello' });
      const item = await wait({ prompt: neverPrompt } as any);
      assert.notEqual(item, null);
      assert.equal(item!.mode, 'prompt');
      assert.equal(item!.value, 'hello');
    });

    it('enqueuePendingNotification 默认 mode 为 task-notification', async () => {
      enqueuePendingNotification({ mode: 'task-notification', value: 'task done' });
      const item = await wait({ prompt: neverPrompt } as any);
      assert.equal(item!.mode, 'task-notification');
      assert.equal(item!.value, 'task done');
      assert.equal(item!.priority, 'later');
    });

    it('enqueue 默认 priority 为 next', async () => {
      enqueue({ mode: 'prompt', value: 'hello' });
      const item = await wait({ prompt: neverPrompt } as any);
      assert.equal(item!.priority, 'next');
    });

    it('wait 按优先级返回: now > next > later', async () => {
      enqueuePendingNotification({ mode: 'task-notification', value: 'low' });   // 默认 later
      enqueue({ mode: 'prompt', value: 'urgent', priority: 'now' });
      enqueue({ mode: 'prompt', value: 'normal' });                              // 默认 next

      const first = await wait({ prompt: neverPrompt } as any);
      assert.equal(first!.value, 'urgent');
      assert.equal(first!.priority, 'now');

      const second = await wait({ prompt: neverPrompt } as any);
      assert.equal(second!.value, 'normal');
      assert.equal(second!.priority, 'next');

      const third = await wait({ prompt: neverPrompt } as any);
      assert.equal(third!.value, 'low');
      assert.equal(third!.priority, 'later');
    });

    it('同优先级 FIFO', async () => {
      enqueue({ mode: 'prompt', value: 'first' });
      enqueue({ mode: 'prompt', value: 'second' });

      assert.equal((await wait({ prompt: neverPrompt } as any))!.value, 'first');
      assert.equal((await wait({ prompt: neverPrompt } as any))!.value, 'second');
    });

    it('enqueue 可触发等待中的 wait', async () => {
      const waitPromise = wait({ prompt: neverPrompt } as any);

      // 微任务让 wait 执行到 Promise constructor
      await new Promise(r => setTimeout(r, 0));

      enqueue({ mode: 'prompt', value: 'triggered' });

      const item = await waitPromise;
      assert.equal(item!.value, 'triggered');
    });
  });

  describe('requestExit', () => {

    it('requestExit 使 wait 返回 null', async () => {
      const waitPromise = wait({ prompt: neverPrompt } as any);

      await new Promise(r => setTimeout(r, 0));

      requestExit();

      const item = await waitPromise;
      assert.equal(item, null);
    });

    it('没有等待者时 requestExit 不报错', () => {
      requestExit(); // 不应抛出
    });
  });

  describe('hasPending / clear', () => {

    it('空队列 hasPending 为 false', () => {
      assert.equal(hasPending(), false);
    });

    it('enqueue 后 hasPending 为 true', () => {
      enqueue({ mode: 'prompt', value: 'hello' });
      assert.equal(hasPending(), true);
    });

    it('clear 清空队列', () => {
      enqueue({ mode: 'prompt', value: 'a' });
      enqueue({ mode: 'prompt', value: 'b' });
      clear();
      assert.equal(hasPending(), false);
    });

    it('队列清空后 wait 进入等待状态（不立即返回）', async () => {
      enqueue({ mode: 'prompt', value: 'should be cleared' });
      clear();
      assert.equal(hasPending(), false);

      // clear 后 enqueue 新消息
      enqueue({ mode: 'prompt', value: 'new message' });
      const item = await wait({ prompt: neverPrompt } as any);
      assert.equal(item!.value, 'new message');
    });
  });

  describe('store 集成 — SK.EnqueuePendingNotification', () => {

    it('可通过 store 注册并获取 enqueuePendingNotification', () => {
      const registry = new PluginRegistry();
      registry.store.set(SK.EnqueuePendingNotification, enqueuePendingNotification);

      const fn = registry.store.get<typeof enqueuePendingNotification>(SK.EnqueuePendingNotification);
      assert.equal(typeof fn, 'function');
      assert.equal(fn, enqueuePendingNotification);
    });

    it('插件在 onInit 中可从 store 获取并调用 enqueuePendingNotification', async () => {
      const registry = new PluginRegistry();
      registry.store.set(SK.EnqueuePendingNotification, enqueuePendingNotification);

      let capturedArgs: any = null;
      const plugin = {
        name: 'test-monitor',
        getTools: () => [],
        async execute() { return { status: 'success' as const }; },
        async onInit(r: PluginRegistry) {
          const fn = r.store.get<typeof enqueuePendingNotification>(SK.EnqueuePendingNotification);
          fn!({ mode: 'task-notification', value: '来自插件的事件', source: 'test-monitor' });
        },
      };
      await registry.register(plugin);

      // onInit 中调用后，队列应有积压
      assert.equal(hasPending(), true);
      const item = await wait({ prompt: neverPrompt } as any);
      assert.equal(item!.mode, 'task-notification');
      assert.equal(item!.value, '来自插件的事件');
      assert.equal(item!.source, 'test-monitor');
      assert.equal(item!.priority, 'later'); // 默认 priority 为 later
    });

    it('未注册 key 时 store.get 返回 undefined', () => {
      const registry = new PluginRegistry();
      assert.equal(registry.store.get(SK.EnqueuePendingNotification), undefined);
    });
  });
});
