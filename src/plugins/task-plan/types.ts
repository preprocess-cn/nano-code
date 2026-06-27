export type PlanMode = 'normal' | 'plan';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
}

export const STORE_KEY_MODE = 'task-plan:mode';
export const STORE_KEY_PLAN_CONTENT = 'task-plan:planContent';
export const STORE_KEY_TASKS = 'task-plan:tasks';
export const STORE_KEY_TASK_COUNT = 'task-plan:taskCount';
