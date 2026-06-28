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

// Store keys moved to src/store-keys.ts — use SK.Mode / SK.PlanContent / SK.Tasks / SK.TaskCount
