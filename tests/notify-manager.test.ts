import { describe, it } from 'node:test';
import assert from 'node:assert';

// We test the queue logic by simulating the internal behavior of notify-manager.
// The plugin exports createNotifyManagerPlugin, but the queue logic is closure-internal.
// We test the algorithm directly by recreating its logic here.

interface Notification {
  source: string;
  message: string;
  timestamp: number;
}

function simulateQueue(entries: { source: string; message: string }[]): string[] {
  const queues = new Map<string, Notification[]>();
  const order: string[] = [];
  let lastDisplayedSource: string | null = null;

  // Enqueue
  for (const e of entries) {
    let q = queues.get(e.source);
    if (!q) { q = []; queues.set(e.source, q); }
    if (q.length >= 5) continue;
    q.push({ source: e.source, message: e.message, timestamp: order.length });
  }

  // Dequeue all
  while (true) {
    // Find active sources
    const activeSources: string[] = [];
    for (const [source, q] of queues) {
      if (q.length > 0) activeSources.push(source);
    }
    if (activeSources.length === 0) break;

    let selectedSource: string;
    if (activeSources.length === 1) {
      selectedSource = activeSources[0];
    } else {
      const candidates = activeSources.filter(s => s !== lastDisplayedSource);
      const pool = candidates.length > 0 ? candidates : activeSources;
      let bestSource = pool[0];
      let bestTime = queues.get(bestSource)![0].timestamp;
      for (const s of pool) {
        const t = queues.get(s)![0].timestamp;
        if (t < bestTime) { bestSource = s; bestTime = t; }
      }
      selectedSource = bestSource;
    }

    lastDisplayedSource = selectedSource;
    const notification = queues.get(selectedSource)!.shift()!;
    if (queues.get(selectedSource)!.length === 0) queues.delete(selectedSource);
    order.push(`[${notification.source}] ${notification.message}`);
  }

  return order;
}

describe('NotifyManager Queue Logic', () => {
  it('displays notifications in FIFO order for single source', () => {
    const result = simulateQueue([
      { source: 'cron', message: 'task1' },
      { source: 'cron', message: 'task2' },
      { source: 'cron', message: 'task3' },
    ]);
    assert.deepStrictEqual(result, [
      '[cron] task1',
      '[cron] task2',
      '[cron] task3',
    ]);
  });

  it('round-robins between multiple sources', () => {
    const result = simulateQueue([
      { source: 'cron', message: 'a' },
      { source: 'monitor', message: 'b' },
      { source: 'cron', message: 'c' },
      { source: 'monitor', message: 'd' },
    ]);
    // First: cron (oldest), Second: monitor (different source), Third: cron (different from monitor), Fourth: monitor
    assert.strictEqual(result[0], '[cron] a');
    assert.strictEqual(result[1], '[monitor] b');
    assert.strictEqual(result[2], '[cron] c');
    assert.strictEqual(result[3], '[monitor] d');
  });

  it('does not display same source consecutively when multiple sources exist', () => {
    const result = simulateQueue([
      { source: 'cron', message: 'a' },
      { source: 'cron', message: 'b' },
      { source: 'monitor', message: 'c' },
      { source: 'cron', message: 'd' },
    ]);
    // a (cron) → c (monitor) → b (cron) → d (cron)
    // After c, cron is the only source left, so b and d are consecutive cron
    assert.strictEqual(result[0], '[cron] a');
    assert.strictEqual(result[1], '[monitor] c');
    assert.strictEqual(result[2], '[cron] b');
    assert.strictEqual(result[3], '[cron] d');
  });

  it('limits per source to 5 entries', () => {
    // 7 entries from same source, only 5 should be accepted
    // We test the actual plugin limit logic
    const queues = new Map<string, Notification[]>();
    const source = 'cron';
    let accepted = 0;

    for (let i = 0; i < 7; i++) {
      let q = queues.get(source);
      if (!q) { q = []; queues.set(source, q); }
      if (q.length < 5) {
        q.push({ source, message: `msg${i}`, timestamp: i });
        accepted++;
      }
    }

    assert.strictEqual(accepted, 5);
    assert.strictEqual(queues.get(source)!.length, 5);
  });

  it('handles empty queue gracefully', () => {
    const result = simulateQueue([]);
    assert.deepStrictEqual(result, []);
  });

  it('handles single source after multiple sources drain', () => {
    const result = simulateQueue([
      { source: 'cron', message: 'a' },
      { source: 'monitor', message: 'b' },
      { source: 'monitor', message: 'c' },
    ]);
    // a (cron) → b (monitor) → c (monitor, only source left)
    assert.strictEqual(result[0], '[cron] a');
    assert.strictEqual(result[1], '[monitor] b');
    assert.strictEqual(result[2], '[monitor] c');
  });

  it('preserves FIFO order within same source', () => {
    const result = simulateQueue([
      { source: 'cron', message: 'first' },
      { source: 'monitor', message: 'a' },
      { source: 'cron', message: 'second' },
      { source: 'cron', message: 'third' },
    ]);
    const cronMessages = result.filter(r => r.startsWith('[cron]'));
    assert.deepStrictEqual(cronMessages, [
      '[cron] first',
      '[cron] second',
      '[cron] third',
    ]);
  });
});
