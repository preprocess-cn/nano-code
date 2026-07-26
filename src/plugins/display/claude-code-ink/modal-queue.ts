import type { PluginRegistry } from '#src/core/plugin.js';
import type { ToolResponse } from '#src/core/contract.js';
import type { PermissionPrompt } from '#src/plugins/display/claude-code-ink/InkApp.js';
import * as path from 'path';

interface ModalEntry {
  id: string;
  type: 'permission' | 'ask_question';
  data: any;
  resolve: (value: any) => void;
  toolName?: string;
}

/**
 * 弹窗 FIFO 队列系统。
 * 管理权限确认和提问弹窗，每次只弹一个。
 */
export class ModalQueue {
  private queue: ModalEntry[] = [];
  private showing = false;
  private nextId = 0;
  private pendingPermission: PermissionPrompt | null = null;
  private permissionResolve: ((value: boolean | 'always_allow') => void) | null = null;
  private pendingQuestions: { questions: any[]; resolve: (answers: Record<string, string>) => void } | null = null;
  private registry: PluginRegistry | null = null;
  private renderFn: (() => void) | null = null;

  setRenderFn(fn: () => void): void {
    this.renderFn = fn;
  }

  /** 注册 permission confirm callback 和 interactive handler */
  registerHandlers(registry: PluginRegistry): void {
    this.registry = registry;

    registry.setConfirmCallback(async (req) => {
      return new Promise<boolean | 'always_allow'>((resolve) => {
        this.queue.push({
          id: `perm-${this.nextId++}`,
          type: 'permission',
          data: req,
          resolve,
          toolName: req.toolName,
        });
        this.processQueue();
      });
    });

    registry.registerInteractiveHandler('ask_user_question', async (args: any) => {
      return new Promise<ToolResponse>((resolve) => {
        this.queue.push({
          id: `ask-${this.nextId++}`,
          type: 'ask_question',
          data: args,
          resolve,
        });
        this.processQueue();
      });
    });
  }

  private processQueue(): void {
    if (this.showing || this.queue.length === 0) return;
    this.showing = true;

    const entry = this.queue[0];

    // 权限请求：用 evaluator 重检查（路径级规则可能已通过前一个弹窗添加）
    if (entry.type === 'permission') {
      const evalFn = this.registry?.store?.get<any>('permission:evaluator');
      if (evalFn) {
        const req = entry.data;
        let fakeArgs: any = {};
        if (req.filePath) {
          fakeArgs = { path: req.filePath };
        } else if (req.details) {
          try {
            const parsed = JSON.parse(req.details);
            if (parsed?.path) fakeArgs = { path: parsed.path };
          } catch {}
        }
        const sideEffect = entry.toolName
          ? this.registry?.getToolSideEffect?.(entry.toolName, fakeArgs) ?? true
          : true;
        const decision = evalFn(entry.toolName, fakeArgs, sideEffect);
        if (decision.behavior !== 'ask') {
          this.showing = false;
          this.queue.shift();
          if (decision.behavior === 'deny') {
            entry.resolve(false);
          } else {
            entry.resolve(decision.behavior === 'allow' ? true : 'always_allow');
          }
          this.processQueue();
          return;
        }
      }
    }

    if (entry.type === 'permission') {
      const req = entry.data;
      this.pendingPermission = {
        toolName: req.toolName,
        displayName: req.displayName,
        message: req.message,
        details: req.details,
        diff: req.diff,
        filePath: req.filePath,
      };
      this.permissionResolve = entry.resolve;
    } else {
      this.pendingQuestions = {
        questions: entry.data.questions,
        resolve: (answers: Record<string, string>) => {
          entry.resolve({ status: 'success', data: JSON.stringify({ questions: entry.data.questions, answers }) });
        },
      };
    }
    this.renderFn?.();
  }

  onModalComplete(): void {
    this.showing = false;
    this.pendingPermission = null;
    this.permissionResolve = null;
    this.pendingQuestions = null;
    this.queue.shift();
    this.renderFn?.();
    this.processQueue();
  }

  getPendingPermission(): PermissionPrompt | null {
    return this.pendingPermission;
  }

  getPendingQuestions(): { questions: any[]; resolve: (answers: Record<string, string>) => void } | null {
    return this.pendingQuestions;
  }

  /** 处理权限响应（always_allow 时添加路径级规则） */
  handlePermissionResponse(response: 'allow_once' | 'always_allow' | 'deny'): void {
    const resolve = this.permissionResolve;
    if (!resolve) return;
    if (response === 'always_allow' && this.pendingPermission?.filePath) {
      const permMgr = this.registry?.store?.get<any>('permission:manager');
      if (permMgr) {
        const parentDir = path.dirname(path.resolve(this.pendingPermission.filePath));
        permMgr.addSessionRule('allow', this.pendingPermission.toolName, parentDir + '/**');
      }
    }
    const result = response === 'allow_once' ? true : response === 'always_allow' ? 'always_allow' : false; // deny → false
    resolve(result);
    this.onModalComplete();
  }

  handleQuestionsResponse(answers: Record<string, string>): void {
    if (this.pendingQuestions) {
      this.pendingQuestions.resolve(answers);
      this.onModalComplete();
    }
  }

  clearAll(): void {
    this.queue = [];
    this.showing = false;
    this.pendingPermission = null;
    this.permissionResolve = null;
    this.pendingQuestions = null;
  }
}
