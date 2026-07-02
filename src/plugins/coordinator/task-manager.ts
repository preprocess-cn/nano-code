import { AgentLifecycle } from '#src/plugins/coordinator/lifecycle.js';

export interface BackgroundTaskInfo {
  taskId: string;
  agentName: string;
  query: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export class BackgroundTaskManager {
  private static instance: BackgroundTaskManager;
  private tasks: Map<string, BackgroundTaskInfo> = new Map();
  private completedQueue: BackgroundTaskInfo[] = [];
  private taskCounter = 0;

  private constructor() {}

  static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager();
    }
    return BackgroundTaskManager.instance;
  }

  /** Reset singleton — used in tests only */
  static resetInstance(): void {
    BackgroundTaskManager.instance = undefined as unknown as BackgroundTaskManager;
  }

  /**
   * Start a background task.
   * The runner is invoked immediately with the assigned taskId.
   * On completion/error, task status is updated
   * and the result is queued for delivery via getCompletedTasks().
   */
  startTask(
    agentName: string,
    query: string,
    runner: (taskId: string) => Promise<string | undefined>,
  ): string {
    const taskId = `task_${++this.taskCounter}`;
    const info: BackgroundTaskInfo = {
      taskId,
      agentName,
      query,
      status: 'running',
      startedAt: new Date(),
    };
    this.tasks.set(taskId, info);

    runner(taskId)
      .then((result) => {
        if (info.completedAt) return; // already cancelled or errored
        info.status = 'completed';
        info.result = result || '(no output)';
        info.completedAt = new Date();
        this.completedQueue.push(info);
      })
      .catch((err) => {
        if (info.completedAt) return; // already cancelled
        info.status = 'error';
        info.error = err instanceof Error ? err.message : String(err);
        info.completedAt = new Date();
        this.completedQueue.push(info);
      });

    return taskId;
  }

  getTask(taskId: string): BackgroundTaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values());
  }

  /** Drain-completed: returns and clears the completed queue. Also cleans up tasks Map. */
  getCompletedTasks(): BackgroundTaskInfo[] {
    const completed = [...this.completedQueue];
    this.completedQueue = [];
    for (const task of completed) {
      this.tasks.delete(task.taskId);
    }
    return completed;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;

    // 通过 lifecycle 真实中断正在执行的子 agent
    AgentLifecycle.getInstance().cancelTask(taskId);

    task.status = 'error';
    task.error = 'cancelled';
    task.completedAt = new Date();
    this.completedQueue.push(task);
    return true;
  }
}
