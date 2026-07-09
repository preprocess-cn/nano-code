import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext, ToolCall } from '#src/core/contract.js';
import { ChatMessage } from '#src/core/llm.js';
import { getPlanModeInstructions } from '#src/core/prompt.js';
import {
  Task, TaskStatus,
} from '#src/plugins/task-plan/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SK } from '#src/core/store-keys.js';

// ── File paths ──

const TASKS_DIR = '.nano-code/tasks';

function tasksDir(): string {
  return path.join(process.cwd(), TASKS_DIR);
}

function ensurePlansDir(): Promise<void> {
  return fs.mkdir(getPlansDir(), { recursive: true }) as unknown as Promise<void>;
}

/** ~/.nano-code/plan/<name>.md */
function planFilePath(name: string): string {
  return path.join(getPlansDir(), `${name}.md`);
}

// ── Module-level overrides (test support) ──

let _testPlansDir: string | undefined;

/**
 * Override the plans directory for testing.
 * Reset by calling with undefined.
 */
export function __setTestPlansDir(dir: string | undefined): void {
  _testPlansDir = dir;
}

export function getPlansDir(): string {
  return _testPlansDir || path.join(os.homedir(), '.nano-code', 'plan');
}

// ── Module-level store reference (set in onInit) ──

let _store: {
  get<T>(key: string): T | undefined;
  set(key: string, value: any): void;
} | null = null;

let _registry: PluginRegistry | null = null;

// ── Exported helpers (for slash commands / other plugins) ──

/** 列出 ~/.nano-code/plan/ 下所有 .md 文件 */
export async function listPlanFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(getPlansDir());
    return entries.filter(e => e.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

// ── Task persistence ──

async function ensureTasksDir(): Promise<void> {
  const dir = tasksDir();
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch { /* exists */ }
}

export async function readAllTasks(): Promise<Task[]> {
  const dir = tasksDir();
  try {
    await fs.access(dir);
  } catch {
    return [];
  }
  const entries = await fs.readdir(dir);
  const tasks: Task[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf-8');
      const task = JSON.parse(content) as Task;
      tasks.push(task);
    } catch {
      // skip corrupt files
    }
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return tasks;
}

async function writeTask(task: Task): Promise<void> {
  await ensureTasksDir();
  await fs.writeFile(
    path.join(tasksDir(), `${task.id}.json`),
    JSON.stringify(task, null, 2),
    'utf-8',
  );
}

async function deleteTaskFile(taskId: string): Promise<boolean> {
  const filePath = path.join(tasksDir(), `${taskId}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Store helpers: sync task cache ──

async function syncTaskCache(): Promise<void> {
  if (!_store) return;
  const tasks = await readAllTasks();
  _store.set(SK.Tasks, tasks);
  _store.set(SK.TaskCount, tasks.length);
}

// ── Tool: enter_plan_mode ──

async function handleEnterPlanMode(): Promise<ToolResponse> {
  if (!_store) {
    return { status: 'error', message: 'Internal error: store not available' };
  }
  const currentMode = _store.get<string>(SK.Mode) || 'normal';
  if (currentMode === 'plan') {
    return { status: 'success', data: 'Already in plan mode.' };
  }
  _store.set(SK.PrePlanMode, currentMode);
  _store.set(SK.Mode, 'plan');
  // 重置 plan mode 提醒计数器（每5轮注入一次）
  _store.set('task-plan:turnCounter', 0);
  _store.set('task-plan:attachmentIndex', 0);
  return {
    status: 'success',
    data: 'Entered plan mode. Use plan_write to write plans. After writing, summarize the plan and wait for the user. Call exit_plan_mode when the user expresses approval and intent to start implementing.',
  };
}

// ── Tool: exit_plan_mode ──

async function handleExitPlanMode(): Promise<ToolResponse> {
  if (!_store) {
    return { status: 'error', message: 'Internal error: store not available' };
  }
  const currentMode = _store.get<string>(SK.Mode) || 'normal';
  if (currentMode !== 'plan') {
    return { status: 'error', message: 'Not in plan mode. Use enter_plan_mode first.' };
  }

  // Read plan from the tracked current plan path
  const currentPlan = _store.get<string>(SK.CurrentPlanPath);
  let planContent = '';
  if (currentPlan) {
    try {
      planContent = await fs.readFile(currentPlan, 'utf-8');
    } catch { /* not found */ }
  }

  // If no current plan, try to find the latest plan file by mtime
  if (!planContent) {
    const dir = getPlansDir();
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      files = [];
    }
    const mdFiles = files.filter(e => e.endsWith('.md'));
    if (mdFiles.length > 0) {
      // Sort by mtime descending to find most recently written
      const withMtime = await Promise.all(
        mdFiles.map(async (f) => {
          try {
            const stat = await fs.stat(path.join(dir, f));
            return { name: f, mtime: stat.mtimeMs };
          } catch {
            return { name: f, mtime: 0 };
          }
        })
      );
      withMtime.sort((a, b) => b.mtime - a.mtime);
      const latest = withMtime[0].name;
      try {
        planContent = await fs.readFile(path.join(dir, latest), 'utf-8');
      } catch { /* not found */ }
    }
  }

  if (!planContent) {
    return { status: 'error', message: `No plan found. Use plan_write to write a plan first. Plans are stored in ${getPlansDir()}` };
  }

  // Store plan content for execution
  _store.set(SK.PlanContent, planContent);
  _store.set(SK.PlanApproved, true);

  // Restore previous mode
  const preMode = _store.get<string>(SK.PrePlanMode) || 'normal';
  _store.set(SK.Mode, preMode);
  _store.set(SK.PrePlanMode, undefined);
  // 标记下一轮注入退出提醒（覆盖旧的 plan mode reminder 遗留）
  _store.set('task-plan:needsExitReminder', true);

  return {
    status: 'success',
    data: planContent,
    message: 'You have exited plan mode and can now make edits, run tools, and take actions.',
  };
}

// ── Tool: task_create ──

async function handleTaskCreate(args: any): Promise<ToolResponse> {
  const { subject, description, activeForm, metadata } = args || {};
  if (!subject || typeof subject !== 'string') {
    return { status: 'error', message: 'Missing required parameter: "subject"' };
  }
  if (!description || typeof description !== 'string') {
    return { status: 'error', message: 'Missing required parameter: "description"' };
  }

  await ensureTasksDir();
  const existingTasks = await readAllTasks();

  const maxId = existingTasks.reduce((max, t) => {
    const n = parseInt(t.id, 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  const id = String(maxId + 1);

  const task: Task = {
    id,
    subject,
    description,
    activeForm: typeof activeForm === 'string' ? activeForm : undefined,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: metadata || undefined,
  };

  await writeTask(task);
  await syncTaskCache();

  return {
    status: 'success',
    data: `Task #${id} created: ${subject}`,
  };
}

// ── Tool: task_list ──

async function handleTaskList(): Promise<ToolResponse> {
  const tasks = await readAllTasks();

  if (tasks.length === 0) {
    return { status: 'success', data: 'No tasks found.' };
  }

  const lines = tasks.map(t => {
    const owner = t.owner ? ` (${t.owner})` : '';
    const blocked =
      t.blockedBy.length > 0
        ? ` [blocked by ${t.blockedBy.map(id => `#${id}`).join(', ')}]`
        : '';
    return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`;
  });

  return { status: 'success', data: lines.join('\n') };
}

// ── Tool: task_update ──

async function handleTaskUpdate(args: any): Promise<ToolResponse> {
  const { taskId, subject, description, activeForm, status, owner, addBlocks, addBlockedBy, metadata } = args || {};
  if (!taskId) {
    return { status: 'error', message: 'Missing required parameter: "taskId"' };
  }

  const tasks = await readAllTasks();
  const idx = tasks.findIndex(t => t.id === String(taskId));
  if (idx === -1) {
    return { status: 'error', message: `Task #${taskId} not found.` };
  }

  const existing = tasks[idx];
  const updated: Task = { ...existing };
  const updatedFields: string[] = [];

  if (subject !== undefined && subject !== existing.subject) {
    updated.subject = subject;
    updatedFields.push('subject');
  }
  if (description !== undefined && description !== existing.description) {
    updated.description = description;
    updatedFields.push('description');
  }
  if (activeForm !== undefined && activeForm !== existing.activeForm) {
    updated.activeForm = activeForm;
    updatedFields.push('activeForm');
  }
  if (owner !== undefined) {
    updated.owner = owner || undefined;
    updatedFields.push('owner');
  }
  if (status !== undefined) {
    const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return { status: 'error', message: `Invalid status: "${status}". Must be one of: ${validStatuses.join(', ')}` };
    }
    updated.status = status as TaskStatus;
    updatedFields.push('status');
  }
  if (addBlocks !== undefined) {
    const newBlocks = Array.isArray(addBlocks) ? addBlocks : [addBlocks];
    for (const b of newBlocks) {
      if (!updated.blocks.includes(String(b))) {
        updated.blocks.push(String(b));
      }
    }
    updatedFields.push('blocks');
  }
  if (addBlockedBy !== undefined) {
    const newBlocked = Array.isArray(addBlockedBy) ? addBlockedBy : [addBlockedBy];
    for (const b of newBlocked) {
      if (!updated.blockedBy.includes(String(b))) {
        updated.blockedBy.push(String(b));
      }
    }
    updatedFields.push('blockedBy');
  }
  if (metadata !== undefined && typeof metadata === 'object') {
    const merged = { ...(updated.metadata ?? {}) };
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    updated.metadata = merged;
    updatedFields.push('metadata');
  }

  if (updatedFields.length === 0) {
    return { status: 'success', data: `Task #${taskId} unchanged.` };
  }

  await writeTask(updated);
  await syncTaskCache();

  return {
    status: 'success',
    data: `Updated task #${taskId}: ${updatedFields.join(', ')}`,
  };
}

// ── Tool: task_stop ──

async function handleTaskStop(args: any): Promise<ToolResponse> {
  const { taskId } = args || {};
  if (!taskId) {
    return { status: 'error', message: 'Missing required parameter: "taskId"' };
  }

  const deleted = await deleteTaskFile(String(taskId));
  if (!deleted) {
    return { status: 'error', message: `Task #${taskId} not found.` };
  }

  await syncTaskCache();

  return { status: 'success', data: `Task #${taskId} deleted.` };
}

// ── Tool: plan_write ──

async function handlePlanWrite(args: any): Promise<ToolResponse> {
  const { filename, content } = args || {};
  if (!filename || typeof filename !== 'string') {
    return { status: 'error', message: 'Missing required parameter: "filename"' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(filename)) {
    return { status: 'error', message: 'filename 只能包含字母、数字、连字符和下划线' };
  }
  if (!content || typeof content !== 'string') {
    return { status: 'error', message: 'Missing required parameter: "content"' };
  }

  await ensurePlansDir();
  const filePath = planFilePath(filename);
  await fs.writeFile(filePath, content, 'utf-8');

  // Track this as the current plan
  if (_store) _store.set(SK.CurrentPlanPath, filePath);

  return {
    status: 'success',
    data: `Plan written to ${filePath}`,
  };
}

// ── Tool: plan_list ──

async function handlePlanList(): Promise<ToolResponse> {
  const files = await listPlanFiles();
  if (files.length === 0) {
    return { status: 'success', data: `${getPlansDir()}\n  (no plans yet)` };
  }
  const lines = files.map(f => `  ${f}`);
  return {
    status: 'success',
    data: [`Plans in ${getPlansDir()}:`, ...lines].join('\n'),
  };
}

// ── Tool definitions ──

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'enter_plan_mode',
      description: 'Enter plan mode for exploration and design. Use plan_write to write plans. Call exit_plan_mode when the user expresses approval and intent to start implementing.',
      parameters: { type: 'object', properties: {}, required: [] },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'exit_plan_mode',
      description: 'Exit plan mode and return the plan content. Call this when the user clearly expresses approval and intent to start implementing (e.g. "开始实行", "开始执行", "execute"). Exits plan mode so you can start implementing.',
      parameters: { type: 'object', properties: {}, required: [] },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_write',
      description: 'Write a plan file to ~/.nano-code/plan/. Use this in plan mode instead of file_write. Use kebab-case for the filename (e.g. "refactor-utils"). The .md extension is added automatically.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Plan name in kebab-case, e.g. "refactor-utils"' },
          content: { type: 'string', description: 'Plan content in markdown' },
        },
        required: ['filename', 'content'],
      },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_list',
      description: 'List all saved plan files in ~/.nano-code/plan/.',
      parameters: { type: 'object', properties: {}, required: [] },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_create',
      description: 'Create a new task in the task list.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Brief title of the task' },
          description: { type: 'string', description: 'What needs to be done' },
          activeForm: { type: 'string', description: 'Present continuous form for spinner, e.g. "Running tests"' },
          metadata: { type: 'object', description: 'Arbitrary metadata', additionalProperties: true },
        },
        required: ['subject', 'description'],
      },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_list',
      description: 'List all tasks with their status, owner, and dependencies.',
      parameters: { type: 'object', properties: {}, required: [] },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_update',
      description: 'Update a task\'s status, subject, owner, or dependencies.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID of the task to update (e.g. "1", "2")' },
          subject: { type: 'string', description: 'New subject for the task' },
          description: { type: 'string', description: 'New description for the task' },
          activeForm: { type: 'string', description: 'Present continuous form for spinner' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status' },
          owner: { type: 'string', description: 'Set task owner (use empty string to clear)' },
          addBlocks: { type: 'array', items: { type: 'string' }, description: 'Task IDs that this task blocks' },
          addBlockedBy: { type: 'array', items: { type: 'string' }, description: 'Task IDs that block this task' },
          metadata: { type: 'object', description: 'Metadata to merge. Set key to null to delete.', additionalProperties: true },
        },
        required: ['taskId'],
      },
      sideEffect: false,
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_stop',
      description: 'Delete a task from the task list.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID of the task to delete (e.g. "1", "2")' },
        },
        required: ['taskId'],
      },
      sideEffect: false,
    },
  },
];

// ── Plugin export ──

export const taskPlanPlugin: NanoPlugin = {
  name: 'task-plan',
  description: 'Plan mode and task management tools',

  getTools(): ToolDefinition[] {
    return TOOLS;
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case 'enter_plan_mode':
        return handleEnterPlanMode();
      case 'exit_plan_mode':
        return handleExitPlanMode();
      case 'plan_write':
        return handlePlanWrite(args);
      case 'plan_list':
        return handlePlanList();
      case 'task_create':
        return handleTaskCreate(args);
      case 'task_list':
        return handleTaskList();
      case 'task_update':
        return handleTaskUpdate(args);
      case 'task_stop':
        return handleTaskStop(args);
      default:
        throw new Error(`Unknown task-plan tool: ${name}`);
    }
  },

	  onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
	    // 退出 plan mode 后的一次性提醒（即使 mode 已切回 normal 也要注入）
	    if (_store?.get('task-plan:needsExitReminder')) {
	      _store!.set('task-plan:needsExitReminder', false);
	      messages.splice(messages.length - 1, 0, {
	        role: 'user',
	        content: `<system-reminder>\nYou have exited plan mode. You can now make edits, run tools, and take actions.\n</system-reminder>`,
	      });
	      return messages;
	    }

	    // Plan mode 提醒节流：agent.ts 每轮都注入完整指令，
	    // 此钩子根据节流策略保留/替换/删除该注入
	    if (!_registry || _store?.get(SK.Mode) !== 'plan') return messages;

	    // 反向搜索最后一条 <system-reminder> 用户消息（不依赖固定位置，
	    // 因为 token-budget 等插件的 onBeforeRequest 可能先于本钩子修改数组长度）
	    let injectionIdx = -1;
	    for (let i = messages.length - 1; i >= 0; i--) {
	      const m = messages[i];
	      if (m.role === 'user' && typeof m.content === 'string' &&
	          m.content.includes('<system-reminder>')) {
	        injectionIdx = i;
	        break;
	      }
	    }
	    if (injectionIdx === -1) return messages;

	    const TURNS_BETWEEN = 5;
	    const FULL_EVERY_N = 5;

	    let turnCounter = (_store!.get<number>('task-plan:turnCounter') ?? 0) + 1;
	    _store!.set('task-plan:turnCounter', turnCounter);

	    // 首次进入 plan mode：完整指令
	    if (turnCounter === 1) {
	      _store!.set('task-plan:attachmentIndex', 0);
	      return messages;
	    }

	    // 每 TURNS_BETWEEN 轮才注入一次，其余跳过
	    if ((turnCounter - 1) % TURNS_BETWEEN !== 0) {
	      messages.splice(injectionIdx, 1);
	      return messages;
	    }

	    // 到此：需要注入。判断完整版(full)还是精简版(sparse)
	    const attachIdx = _store!.get<number>('task-plan:attachmentIndex') ?? 0;
	    _store!.set('task-plan:attachmentIndex', attachIdx + 1);

	    if (attachIdx % FULL_EVERY_N === 0) {
	      // 每 FULL_EVERY_N 次附件 = full 版（agent.ts 已注入，保留原样）
	      return messages;
	    }

	    // sparse 版：替换为简短提醒
	    messages[injectionIdx] = {
	      role: 'user',
	      content: `<system-reminder>\n${getPlanModeInstructions('sparse')}\n</system-reminder>`,
	    };
	    return messages;
	  },


  onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
    // Plan mode: 拦截所有有 sideEffect 的工具调用
    if (_registry && _store?.get(SK.Mode) === 'plan') {
      const sideEffect = _registry.getToolSideEffect(toolCall.function.name);
      if (sideEffect) {
        return null; // 核心循环会处理 null 并返回错误给 LLM
      }
    }
    return toolCall;
  },

  async onInit(registry) {
    _registry = registry;
    _store = registry.store;
    // Sync task cache from disk on startup
    const tasks = await readAllTasks();
    _store.set(SK.Tasks, tasks);
    _store.set(SK.TaskCount, tasks.length);
    // Default mode is normal
    if (!_store.get(SK.Mode)) {
      _store.set(SK.Mode, 'normal');
    }
  },
};
