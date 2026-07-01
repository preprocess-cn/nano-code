/**
 * AgentLifecycle — 中间层生命周期管理器。
 *
 * 管理者 agent 层级树的 AbortController，使父 agent 能真实中断子 agent 的执行。
 * - 根控制器终止所有子 agent（shutdown）
 * - 任务级控制器终止单个子 agent（cancelTask）
 * - 子 agent 通过注入的 controller 在 LLM 请求层被中断
 */
export class AgentLifecycle {
  private static instance: AgentLifecycle;
  private rootController = new AbortController();
  private taskControllers = new Map<string, AbortController>();

  private constructor() {
    // 单监听器模式：根 abort 时遍历所有活跃的任务控制器
    if (!this.rootController.signal.aborted) {
      this.rootController.signal.addEventListener('abort', () => {
        for (const [, ctrl] of this.taskControllers) {
          if (!ctrl.signal.aborted) ctrl.abort(this.rootController.signal.reason);
        }
      }, { once: true });
    }
  }

  static getInstance(): AgentLifecycle {
    if (!AgentLifecycle.instance) {
      AgentLifecycle.instance = new AgentLifecycle();
    }
    return AgentLifecycle.instance;
  }

  /** 仅用于测试 */
  static resetInstance(): void {
    AgentLifecycle.instance = undefined as unknown as AgentLifecycle;
  }

  /**
   * 创建任务级 AbortController（级联到根控制器）。
   * 根 abort 时所有任务控制器自动 abort。
   */
  createTaskController(taskId: string): AbortController {
    const controller = new AbortController();
    this.taskControllers.set(taskId, controller);
    return controller;
  }

  /** 取消指定任务：abort 其控制器，真实中断 LLM 请求 */
  cancelTask(taskId: string): boolean {
    const controller = this.taskControllers.get(taskId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new Error('cancelled'));
    return true;
  }

  /** 终止所有任务 */
  shutdown(): void {
    if (!this.rootController.signal.aborted) {
      this.rootController.abort(new Error('shutdown'));
    }
    this.taskControllers.clear();
  }

  /** 摘除已终止任务的控制器引用 */
  cleanup(taskId: string): void {
    this.taskControllers.delete(taskId);
  }
}
