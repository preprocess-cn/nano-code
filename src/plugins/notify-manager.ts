import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import type { DisplayNotifier } from '#src/display.js';
import { SK } from '#src/core/store-keys.js';
import type { ToolResponse, ToolContext } from '#src/core/contract.js';

// ── Types ──

interface Notification {
  source: string;
  message: string;
  timestamp: number;
}

export interface NotifyManagerConfig {
  displayMgr?: DisplayNotifier;
  displayInterval?: number; // ms, default 2000
}

// ── Plugin ──

export function createNotifyManagerPlugin(config?: NotifyManagerConfig): NanoPlugin {
  const cfg = {
    displayMgr: config?.displayMgr ?? null,
    displayInterval: config?.displayInterval ?? 2000,
  };

  // per-source queues
  const queues = new Map<string, Notification[]>();
  let lastDisplayedSource: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;
  let _registryRef: PluginRegistry | null = null;

  // 保存原始 setNotify 引用，在 processQueue 内部使用（绕过外层包装避免循环）
  const _origSetNotify = cfg.displayMgr?.setNotify.bind(cfg.displayMgr) ?? null;

  // ── Queue management ──

  function pickNext(): Notification | null {
    if (queues.size === 0) return null;

    // Find all sources with queued messages
    const activeSources: string[] = [];
    for (const [source, q] of queues) {
      if (q.length > 0) activeSources.push(source);
    }
    if (activeSources.length === 0) return null;

    // If only one source, or no other source has messages — pick from any
    if (activeSources.length === 1) {
      const source = activeSources[0];
      const notification = queues.get(source)!.shift()!;
      // Clean up empty queues
      if (queues.get(source)!.length === 0) queues.delete(source);
      return notification;
    }

    // Multiple sources — prefer a source different from the last displayed
    const candidates = activeSources.filter(s => s !== lastDisplayedSource);
    // If all remaining sources are the same as last, pick from any
    const pool = candidates.length > 0 ? candidates : activeSources;

    // Pick the candidate with the oldest first message (FIFO by source)
    let bestSource = pool[0];
    let bestTime = queues.get(bestSource)![0].timestamp;
    for (const s of pool) {
      const t = queues.get(s)![0].timestamp;
      if (t < bestTime) { bestSource = s; bestTime = t; }
    }

    lastDisplayedSource = bestSource;
    const notification = queues.get(bestSource)!.shift()!;
    if (queues.get(bestSource)!.length === 0) queues.delete(bestSource);
    return notification;
  }

  function processQueue(): void {
    if (isRunning) return;
    isRunning = true;

    const notification = pickNext();
    if (!notification) {
      // Queue empty — clear display (使用原始引用，不经过外层包装)
      _origSetNotify?.(null, null);
      isRunning = false;
      timer = null; // 重置 timer 以便 start() 能再次调度
      return;
    }

    // Send to display (使用原始引用，不经过外层包装)
    _origSetNotify?.(notification.source, notification.message);

    // Schedule next
    timer = setTimeout(() => {
      isRunning = false;
      processQueue();
    }, cfg.displayInterval);
  }

  function start(): void {
    if (timer !== null) return; // already running
    processQueue();
  }

  function stop(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    isRunning = false;
  }

  /**
   * Send a notification to the queue.
   * @returns true if accepted, false if the queue for this source is full (max 5)
   */
  function sendNotify(source: string, message: string): boolean {
    let q = queues.get(source);
    if (!q) {
      q = [];
      queues.set(source, q);
    }
    if (q.length >= 5) return false;

    q.push({ source, message, timestamp: Date.now() });
    start();
    return true;
  }

  return {
    name: 'notify-manager',
    description: 'Manage and display transient notification messages on the status bar',

    getTools(): any[] {
      return [];
    },

    async execute(_name: string, _args: any, _ctx: ToolContext): Promise<ToolResponse> {
      return { status: 'success' };
    },

    async onInit(registry: PluginRegistry): Promise<void> {
      _registryRef = registry;
      // Register the sendNotify function in the shared store
      registry.store.set(SK.NotifySend, sendNotify);

      // ── 拦截 DisplayManager.setNotify ──
      // 外部插件（如 nano-code-monitor）直接调用 display.setNotify(source, message) 时，
      // 将其路由到 notify-manager 队列，确保 2s 自动清除。
      // 清除请求（source/message 为 null）直接透传。
      // 使用 _origSetNotify 内部调用避免循环。
      if (cfg.displayMgr && _origSetNotify) {
        const dm = cfg.displayMgr as any;
        dm.setNotify = (source: string | null, message: string | null) => {
          if (source && message) {
            sendNotify(source, message);
          } else {
            _origSetNotify(null, null);
          }
        };
      }
    },

    async onDestroy(): Promise<void> {
      stop();
      queues.clear();
    },
  };
}
