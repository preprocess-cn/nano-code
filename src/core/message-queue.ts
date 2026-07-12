import type { DisplayManager } from '#src/display.js';

// ── Types ──

export type QueueMode = 'prompt' | 'task-notification';
export type QueuePriority = 'now' | 'next' | 'later';

export type QueuedCommand = {
  mode: QueueMode;
  value: string;
  priority?: QueuePriority;
  /** 事件来源（monitor、sub-agent 等），用户输入为 undefined */
  source?: string;
  /** 事件原始数据（后续可扩展，如 exit_code、metadata） */
  raw?: Record<string, unknown>;
};

// ── Module-level queue ──

const commandQueue: QueuedCommand[] = [];
let waitResolve: ((item: QueuedCommand | null) => void) | null = null;

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
};

function dequeueByPriority(): QueuedCommand | undefined {
  if (commandQueue.length === 0) return undefined;
  let bestIdx = 0;
  let bestPrio = PRIORITY_ORDER[commandQueue[0].priority ?? 'next'];
  for (let i = 1; i < commandQueue.length; i++) {
    const p = PRIORITY_ORDER[commandQueue[i].priority ?? 'next'];
    if (p < bestPrio) { bestIdx = i; bestPrio = p; }
  }
  return commandQueue.splice(bestIdx, 1)[0];
}

function triggerWait(): void {
  if (waitResolve) {
    const item = dequeueByPriority();
    if (item) {
      const r = waitResolve;
      waitResolve = null;
      r(item);
    }
  }
}

/**
 * 用户输入入队。
 * 默认优先级为 'next'，确保在事件通知之前被处理。
 */
export function enqueue(command: Omit<QueuedCommand, 'priority'> & { priority?: QueuePriority }): void {
  commandQueue.push({ ...command, priority: command.priority ?? 'next' });
  triggerWait();
}

/**
 * 后台事件通知入队。
 * 默认优先级为 'later'，确保事件不会阻塞用户输入。
 */
export function enqueuePendingNotification(command: Omit<QueuedCommand, 'priority'> & { priority?: QueuePriority }): void {
  commandQueue.push({ ...command, priority: command.priority ?? 'later' });
  triggerWait();
}

/**
 * 阻塞等待下一个命令。
 *
 * 先检查队列积压（agent 忙碌时累积的命令），有则立即返回最高优先级命令。
 * 无积压时注册 waitResolve 回调，等待 enqueue()/requestExit() 触发。
 *
 * Ink display：prompt() 永不 resolve，输入走 enqueue() → 触发 waitResolve
 * REPL/CLI display：prompt() 返回文本 → 包装为 QueuedCommand → 返回
 */
export async function wait(displayMgr: DisplayManager): Promise<QueuedCommand | null> {
  const backlog = dequeueByPriority();
  if (backlog) return backlog;

  return new Promise(resolve => {
    waitResolve = resolve;
    displayMgr.prompt().then(text => {
      if (waitResolve) {
        waitResolve = null;
        resolve(text !== null ? { mode: 'prompt', value: text, priority: 'next' } : null);
      }
    });
  });
}

/**
 * 请求退出。
 * 被 Ink onExit 或 SIGINT handler 调用，resolve 当前的 wait() 为 null → runMainLoop 退出。
 * 不经过队列，独立路径。
 */
export function requestExit(): void {
  if (waitResolve) {
    const r = waitResolve;
    waitResolve = null;
    r(null);
  }
}

/** 检查队列中是否有待处理的命令 */
export function hasPending(): boolean {
  return commandQueue.length > 0;
}

/** 清空队列 */
export function clear(): void {
  commandQueue.length = 0;
}

/** 重置队列状态（测试用） */
export function reset(): void {
  commandQueue.length = 0;
  waitResolve = null;
}
