import * as path from 'path';
import * as fs from 'fs';
import { schedule, validate, ScheduledTask } from 'node-cron';

export interface CronTask {
  id: string;
  cron: string;
  prompt: string;
  description?: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string;
  expiresAt?: string;
  firedCount: number;
}

interface CronCreateParams {
  cron: string;
  prompt: string;
  description?: string;
  recurring: boolean;
  durable: boolean;
}

const MAX_TASKS = 50;
const RECURRING_TTL_DAYS = 7;
const PERSISTENCE_FILENAME = 'cron-tasks.json';

export class CronScheduler {
  private static instance: CronScheduler | null = null;

  private tasks = new Map<string, CronTask>();
  private jobs = new Map<string, ScheduledTask>();
  private firedQueue: CronTask[] = [];
  private injectedSinceFire = new Set<string>();
  private nextId = 1;
  private _initialized = false;
  private persistencePath = '';

  static getInstance(): CronScheduler {
    if (!CronScheduler.instance) {
      CronScheduler.instance = new CronScheduler();
    }
    return CronScheduler.instance;
  }

  /** 仅测试用：重置单例 */
  static resetInstance(): void {
    if (CronScheduler.instance) {
      CronScheduler.instance.cancelAll();
      CronScheduler.instance = null;
    }
  }

  resolvePersistencePath(cwd?: string): string {
    const dir = path.join(cwd || process.cwd(), '.nano-code');
    return path.join(dir, PERSISTENCE_FILENAME);
  }

  initialize(cwd?: string): void {
    if (this._initialized) return;
    this._initialized = true;
    if (!this.persistencePath) {
      this.persistencePath = this.resolvePersistencePath(cwd);
    }

    const tasks = this.loadPersistent();
    for (const task of tasks) {
      // 跳过已过期的
      if (task.expiresAt && new Date(task.expiresAt) <= new Date()) continue;
      this.registerNodeCronJob(task);
      this.tasks.set(task.id, task);
      const idNum = parseInt(task.id.replace('cron_', ''), 10);
      if (!isNaN(idNum) && idNum >= this.nextId) this.nextId = idNum + 1;
    }
  }

  // ── Public API ──

  createTask(params: CronCreateParams): CronTask | { error: string } {
    if (!validate(params.cron)) {
      return { error: `cron 表达式无效: "${params.cron}"` };
    }
    if (this.tasks.size >= MAX_TASKS) {
      return { error: `超过最大任务数量限制 (${MAX_TASKS})` };
    }

    this.checkExpiry();

    const id = `cron_${this.nextId++}`;
    const now = new Date();
    const task: CronTask = {
      id,
      cron: params.cron,
      prompt: params.prompt,
      description: params.description,
      recurring: params.recurring,
      durable: params.durable,
      createdAt: now.toISOString(),
      firedCount: 0,
    };

    // 循环任务自动设 7 天过期
    if (params.recurring) {
      const expires = new Date(now.getTime() + RECURRING_TTL_DAYS * 24 * 60 * 60 * 1000);
      task.expiresAt = expires.toISOString();
    }

    this.registerNodeCronJob(task);
    this.tasks.set(id, task);
    this.persistTasks();

    return task;
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
    this.tasks.delete(id);
    this.injectedSinceFire.delete(id);
    this.persistTasks();

    return true;
  }

  listTasks(): CronTask[] {
    this.checkExpiry();
    return Array.from(this.tasks.values());
  }

  getTask(id: string): CronTask | undefined {
    return this.tasks.get(id);
  }

  cancelAll(): void {
    const path = this.persistencePath;
    for (const [id, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    this.tasks.clear();
    this.firedQueue = [];
    this.injectedSinceFire.clear();
    // 尝试保留持久化路径
    this.persistencePath = path;
  }

  /** 消费并清空 fired 队列 */
  drainFired(): CronTask[] {
    const pending: CronTask[] = [];
    for (const task of this.firedQueue) {
      if (!this.injectedSinceFire.has(task.id)) {
        pending.push(task);
        this.injectedSinceFire.add(task.id);
      }
    }
    this.firedQueue = [];
    return pending;
  }

  /** 清除本轮已注入标记（由 onAfterRequest 调用） */
  clearInjectedSinceFire(): void {
    this.injectedSinceFire.clear();
  }

  // ── Internal ──

  private registerNodeCronJob(task: CronTask): void {
    try {
      const job = schedule(task.cron, () => {
        try {
          this.onFire(task);
        } catch (err) {
          console.error(`[cron] job fire error: ${err}`);
        }
      });
      this.jobs.set(task.id, job);
    } catch (err) {
      console.error(`[cron] failed to schedule task ${task.id}: ${err}`);
    }
  }

  private onFire(task: CronTask): void {
    // 检查过期
    if (task.expiresAt && new Date(task.expiresAt) <= new Date()) {
      this.jobs.get(task.id)?.stop();
      this.jobs.delete(task.id);
      this.tasks.delete(task.id);
      this.injectedSinceFire.delete(task.id);
      this.persistTasks();
      return;
    }

    task.firedCount++;
    this.firedQueue.push({ ...task });
    this.injectedSinceFire.delete(task.id);

    if (!task.recurring) {
      this.jobs.get(task.id)?.stop();
      this.jobs.delete(task.id);
      this.tasks.delete(task.id);
      this.persistTasks();
    }
  }

  private checkExpiry(): void {
    const now = new Date();
    let changed = false;
    for (const [id, task] of this.tasks) {
      if (task.expiresAt && new Date(task.expiresAt) <= now) {
        this.jobs.get(id)?.stop();
        this.jobs.delete(id);
        this.tasks.delete(id);
        this.injectedSinceFire.delete(id);
        changed = true;
      }
    }
    if (changed) this.persistTasks();
  }

  private persistTasks(): void {
    if (!this.persistencePath) return;
    const durable = Array.from(this.tasks.values()).filter(t => t.durable);
    const data = { version: 1, tasks: durable };
    try {
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 持久化写入失败可接受
    }
  }

  private loadPersistent(): CronTask[] {
    if (!this.persistencePath) return [];
    try {
      if (!fs.existsSync(this.persistencePath)) return [];
      const raw = fs.readFileSync(this.persistencePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.version === 1 && Array.isArray(data.tasks)) {
        return data.tasks;
      }
      return [];
    } catch {
      return [];
    }
  }
}
