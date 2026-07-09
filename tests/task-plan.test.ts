import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { taskPlanPlugin, __setTestPlansDir } from '../src/plugins/tools/task-plan.js';
import { ToolContext } from '../src/core/contract.js';
import { SK } from '../src/core/store-keys.js';
import type { ChatMessage } from '../src/core/llm.js';

// ── Helpers ──

const CTX: ToolContext = {
  skipPermission: true,
  cwd: process.cwd(),
  defaultTimeout: 30000,
  sideEffect: true,
};

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nano-code-task-plan-test-'));
}

function removeTempDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a test plan file to a specific plan dir via plan_write tool */
async function writeTestPlan(name: string, content: string) {
  const res = await taskPlanPlugin.execute('plan_write', { filename: name, content }, CTX);
  return res;
}

/** In-memory store for testing */
function createTestStore() {
  const data = new Map<string, any>();
  return {
    get: <T>(key: string): T | undefined => data.get(key) as T | undefined,
    set: (key: string, value: any) => { data.set(key, value); },
    data,
  };
}

/** Get the task files directory from the plugin's convention */
function getTasksDir(): string {
  return path.join(process.cwd(), '.nano-code', 'tasks');
}

// ── Tests ──

describe('task-plan 插件 — enter_plan_mode', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    // Init the plugin store reference by calling onInit
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('enter_plan_mode 切换到 plan 模式', async () => {
    const res = await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert.equal(store.get(SK.Mode), 'plan');
  });

  test('enter_plan_mode 重复进入返回已有提示', async () => {
    store.set(SK.Mode, 'plan');
    const res = await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('Already in plan mode'));
  });

  test('enter_plan_mode 返回进入 plan mode 的提示', async () => {
    const res = await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('plan mode'));
  });
});

describe('task-plan 插件 — exit_plan_mode', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    __setTestPlansDir(tmpDir);
    store = createTestStore();
    store.set(SK.Mode, 'plan');
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    __setTestPlansDir(undefined);
    if (tmpDir) removeTempDir(tmpDir);
  });

  test('exit_plan_mode 无计划文件时报错', async () => {
    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('No plan found'));
  });

  test('exit_plan_mode 保存计划并退出 plan 模式', async () => {
    await writeTestPlan('test-plan', '1. Refactor utils\n2. Add tests');

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('Refactor utils'));
    // Mode should be back to normal
    assert.equal(store.get(SK.Mode), 'normal');
    // Plan should be approved
    assert.equal(store.get(SK.PlanApproved), true);
  });

  test('exit_plan_mode 恢复 PrePlanMode', async () => {
    await writeTestPlan('test-plan', 'Test plan');
    store.set(SK.PrePlanMode, 'custom-mode');

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert.equal(store.get(SK.Mode), 'custom-mode');
    assert.equal(store.get(SK.PrePlanMode), undefined);
  });

  test('exit_plan_mode 无 PrePlanMode 时恢复 normal', async () => {
    await writeTestPlan('test-plan', 'Plan content');

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert.equal(store.get(SK.Mode), 'normal');
  });

  test('exit_plan_mode 设置 PlanContent 和 PlanApproved', async () => {
    await writeTestPlan('my-plan', 'Step 1\nStep 2');

    await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(store.get(SK.PlanApproved), true);
    assert(store.get<string>(SK.PlanContent)?.includes('Step 1'));
  });

  test('plan_write 写入并跟踪当前计划路径', async () => {
    const res = await writeTestPlan('my-plan', 'Content');
    assert.equal(res.status, 'success');
    assert(res.data?.includes('my-plan.md'));

    const trackedPath = store.get<string>(SK.CurrentPlanPath);
    assert(trackedPath, 'should track current plan path');
    assert(trackedPath?.includes('my-plan.md'));
  });

  test('plan_write 拒绝路径遍历', async () => {
    const res = await taskPlanPlugin.execute('plan_write', { filename: '../../etc/passwd', content: 'evil' }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('filename'));
  });

  test('plan_write 拒绝非法字符', async () => {
    const res = await taskPlanPlugin.execute('plan_write', { filename: 'my plan!', content: 'test' }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('filename'));
  });

  test('plan_list 列出所有计划文件', async () => {
    await writeTestPlan('plan-a', 'Plan A');
    await writeTestPlan('plan-b', 'Plan B');

    const res = await taskPlanPlugin.execute('plan_list', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('plan-a.md'));
    assert(res.data?.includes('plan-b.md'));
  });
});

describe('task-plan 插件 — PrePlanMode', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('enter_plan_mode 存储前一个模式到 PrePlanMode', async () => {
    store.set(SK.Mode, 'normal');
    await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(store.get(SK.PrePlanMode), 'normal');
    assert.equal(store.get(SK.Mode), 'plan');
  });

  test('enter_plan_mode 从其他模式进入时存储原模式', async () => {
    store.set(SK.Mode, 'custom');
    await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(store.get(SK.PrePlanMode), 'custom');
  });

  test('enter_plan_mode 重复进入不覆盖 PrePlanMode', async () => {
    store.set(SK.Mode, 'plan');
    store.set(SK.PrePlanMode, 'normal');
    await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(store.get(SK.PrePlanMode), 'normal');
  });
});

describe('task-plan 插件 — task_create', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('task_create 创建任务并返回 ID', async () => {
    const res = await taskPlanPlugin.execute('task_create', {
      subject: '添加登录功能',
      description: '实现用户登录的 JWT 认证流程',
    }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('Task #1 created'));
  });

  test('task_create 缺少 subject 时报错', async () => {
    const res = await taskPlanPlugin.execute('task_create', {
      description: 'some task',
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('subject'));
  });

  test('task_create 生成递增 ID', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'Task A', description: 'First',
    }, CTX);
    const res2 = await taskPlanPlugin.execute('task_create', {
      subject: 'Task B', description: 'Second',
    }, CTX);
    assert(res2.data?.includes('Task #2 created'));
  });

  test('task_create 写入文件并更新缓存', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'File Task', description: 'Should persist',
    }, CTX);

    const tasksDir = getTasksDir();
    const files = fs.readdirSync(tasksDir);
    assert.equal(files.length, 1);
    assert(files[0].endsWith('.json'));

    const content = JSON.parse(fs.readFileSync(path.join(tasksDir, files[0]), 'utf-8'));
    assert.equal(content.subject, 'File Task');
    assert.equal(content.status, 'pending');
  });

  test('task_create 支持 activeForm', async () => {
    const res = await taskPlanPlugin.execute('task_create', {
      subject: 'Test', description: 'Testing', activeForm: 'Running tests',
    }, CTX);
    assert.equal(res.status, 'success');

    const tasksDir = getTasksDir();
    const content = JSON.parse(fs.readFileSync(path.join(tasksDir, '1.json'), 'utf-8'));
    assert.equal(content.activeForm, 'Running tests');
  });
});

describe('task-plan 插件 — task_list', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('task_list 空列表返回提示', async () => {
    const res = await taskPlanPlugin.execute('task_list', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('No tasks'));
  });

  test('task_list 返回创建的任务', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'Login', description: 'Add login',
    }, CTX);
    await taskPlanPlugin.execute('task_create', {
      subject: 'Logout', description: 'Add logout',
    }, CTX);

    const res = await taskPlanPlugin.execute('task_list', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('Login'));
    assert(res.data?.includes('Logout'));
    assert(res.data?.includes('#1'));
    assert(res.data?.includes('#2'));
  });
});

describe('task-plan 插件 — task_update', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
    await taskPlanPlugin.execute('task_create', {
      subject: 'My Task', description: 'Something to do',
    }, CTX);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('task_update 更新状态', async () => {
    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '1', status: 'in_progress',
    }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('Updated task #1'));
    assert(res.data?.includes('status'));
  });

  test('task_update 更新 subject 和 owner', async () => {
    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '1', subject: 'New Title', owner: 'alice',
    }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('subject'));
    assert(res.data?.includes('owner'));

    // Verify persisted
    const tasksDir = getTasksDir();
    const content = JSON.parse(fs.readFileSync(path.join(tasksDir, '1.json'), 'utf-8'));
    assert.equal(content.subject, 'New Title');
    assert.equal(content.owner, 'alice');
  });

  test('task_update 不存在的任务报错', async () => {
    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '999', status: 'completed',
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('not found'));
  });

  test('task_update 无效状态报错', async () => {
    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '1', status: 'invalid_status',
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('Invalid status'));
  });

  test('task_update 添加依赖', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'Task B', description: 'Depends on A',
    }, CTX);

    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '2', addBlockedBy: ['1'],
    }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('blockedBy'));

    // Verify
    const tasksDir = getTasksDir();
    const content = JSON.parse(fs.readFileSync(path.join(tasksDir, '2.json'), 'utf-8'));
    assert.deepEqual(content.blockedBy, ['1']);
  });

  test('task_update 无变更返回不变', async () => {
    const res = await taskPlanPlugin.execute('task_update', {
      taskId: '1',
    }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('unchanged'));
  });
});

describe('task-plan 插件 — task_stop', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
    await taskPlanPlugin.execute('task_create', {
      subject: 'To Delete', description: 'Will be deleted',
    }, CTX);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('task_stop 删除存在的任务', async () => {
    const res = await taskPlanPlugin.execute('task_stop', { taskId: '1' }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('deleted'));

    // Verify file is gone
    const tasksDir = getTasksDir();
    assert.equal(fs.readdirSync(tasksDir).length, 0);
  });

  test('task_stop 不存在的任务报错', async () => {
    const res = await taskPlanPlugin.execute('task_stop', { taskId: '999' }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('not found'));
  });

  test('task_stop 缺少 taskId 时报错', async () => {
    const res = await taskPlanPlugin.execute('task_stop', {}, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('taskId'));
  });
});

describe('task-plan 插件 — store 缓存同步', () => {
  let origCwd: typeof process.cwd;
  let tmpDir: string;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    tmpDir = createTempDir();
    origCwd = process.cwd;
    (process.cwd as any) = () => tmpDir;
    store = createTestStore();
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('task_create 更新 SK.TaskCount', async () => {
    assert.equal(store.get(SK.TaskCount), 0);
    await taskPlanPlugin.execute('task_create', {
      subject: 'Task 1', description: 'First',
    }, CTX);
    assert.equal(store.get(SK.TaskCount), 1);
    await taskPlanPlugin.execute('task_create', {
      subject: 'Task 2', description: 'Second',
    }, CTX);
    assert.equal(store.get(SK.TaskCount), 2);
  });

  test('task_stop 更新 SK.TaskCount', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'Task', description: 'To delete',
    }, CTX);
    assert.equal(store.get(SK.TaskCount), 1);
    await taskPlanPlugin.execute('task_stop', { taskId: '1' }, CTX);
    assert.equal(store.get(SK.TaskCount), 0);
  });

  test('task_update 更新 SK.Tasks', async () => {
    await taskPlanPlugin.execute('task_create', {
      subject: 'My Task', description: 'Test',
    }, CTX);
    await taskPlanPlugin.execute('task_update', {
      taskId: '1', status: 'completed',
    }, CTX);
    const tasks = store.get<any[]>(SK.Tasks) ?? [];
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'completed');
  });
});

describe('task-plan 插件 — plan mode 钩子', () => {
  let store: ReturnType<typeof createTestStore>;
  let registry: any;

  beforeEach(async () => {
    store = createTestStore();
    registry = {
      store,
      getPluginConfig: () => ({}),
      getToolSideEffect: (name: string) => {
        const map: Record<string, boolean> = {
          write_file_content: true,
          patch_file: true,
          run_bash_command: true,
          list_project_files: false,
          view_file_content: false,
          plan_write: false,
          plan_list: false,
        };
        return map[name] ?? true;
      },
    };
    await taskPlanPlugin.onInit!(registry);
  });

  test('enter_plan_mode 重置提醒计数器', async () => {
    store.set('task-plan:turnCounter', 42);
    store.set('task-plan:attachmentIndex', 7);

    await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(store.get('task-plan:turnCounter'), 0);
    assert.equal(store.get('task-plan:attachmentIndex'), 0);
  });

  test('exit_plan_mode 设置退出提醒标志', async () => {
    store.set(SK.Mode, 'plan');
    store.set(SK.PrePlanMode, 'normal');
    await taskPlanPlugin.execute('plan_write', { filename: 'my-plan', content: 'plan content' }, CTX);
    await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);

    assert.equal(store.get('task-plan:needsExitReminder'), true);
  });

  test('exit_plan_mode 返回退出通知消息', async () => {
    store.set(SK.Mode, 'plan');
    store.set(SK.PrePlanMode, 'normal');
    await taskPlanPlugin.execute('plan_write', { filename: 'my-plan', content: 'content' }, CTX);

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert(res.message?.includes('exited plan mode'));
  });

  test('onBeforeRequest 退出后注入退出提醒', async () => {
    store.set('task-plan:needsExitReminder', true);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'continue' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3);
    assert(result[1].content?.includes('exited plan mode'));
    assert.equal(store.get('task-plan:needsExitReminder'), false);
  });

  test('onBeforeRequest 首次注入完整指令', async () => {
    store.set(SK.Mode, 'plan');

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first turn' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3, '应注入 plan mode 提醒');
    assert(result[1].content?.includes('Plan mode is active'), '首次应注入 full 版');
    assert.equal(store.get('task-plan:turnCounter'), 1);
    assert.equal(store.get('task-plan:attachmentIndex'), 0);
  });

  test('onBeforeRequest 第2轮跳过注入', async () => {
    store.set(SK.Mode, 'plan');
    store.set('task-plan:turnCounter', 1);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'turn 2' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 2, '第2轮不应注入');
    assert.equal(store.get('task-plan:turnCounter'), 2);
  });

  test('onBeforeRequest 第6轮注入完整版（首次周期性附件）', async () => {
    store.set(SK.Mode, 'plan');
    store.set('task-plan:turnCounter', 5);
    store.set('task-plan:attachmentIndex', 0);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'turn 6' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3, '应注入 plan mode 提醒');
    // attachIdx=0 → 0%5===0 → 完整版
    assert(result[1].content?.includes('Plan mode is active'), '应包含 full 版指令');
    assert(!result[1].content?.includes('Plan mode still active'), '不应包含 sparse 版指令');
    assert.equal(store.get('task-plan:attachmentIndex'), 1);
  });

  test('onBeforeRequest 第11轮注入精简版', async () => {
    store.set(SK.Mode, 'plan');
    store.set('task-plan:turnCounter', 10);
    store.set('task-plan:attachmentIndex', 1);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'turn 11' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3, '应注入 plan mode 提醒');
    // attachIdx=1 → 1%5!==0 → 精简版
    assert(result[1].content?.includes('Plan mode still active'), '应包含 sparse 版指令');
    assert.equal(store.get('task-plan:attachmentIndex'), 2);
  });
  test('onBeforeRequest 第16轮注入精简版（中间索引）', async () => {
    store.set(SK.Mode, 'plan');
    store.set('task-plan:turnCounter', 15);
    store.set('task-plan:attachmentIndex', 2);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'turn 16' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3, '应注入 plan mode 提醒');
    // attachIdx=2 → 2%5!==0 → 精简版
    assert(result[1].content?.includes('Plan mode still active'), '中间索引应注入 sparse 版');
    assert.equal(store.get('task-plan:attachmentIndex'), 3);
  });

  test('onBeforeRequest 第31轮恢复完整版（周期复位）', async () => {
    store.set(SK.Mode, 'plan');
    store.set('task-plan:turnCounter', 30);
    store.set('task-plan:attachmentIndex', 5);

    const msgs: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'turn 31' },
    ];
    const result = taskPlanPlugin.onBeforeRequest!(msgs);
    assert.equal(result.length, 3, '应注入 plan mode 提醒');
    // attachIdx=5 → 5%5===0 → 完整版
    assert(result[1].content?.includes('Plan mode is active'), '第5次附件应恢复 full 版');
    assert(!result[1].content?.includes('Plan mode still active'), 'full 版不应包含 sparse 内容');
    assert.equal(store.get('task-plan:attachmentIndex'), 6);
  });

  test('onBeforeToolCall plan mode 拦截 write_file_content', async () => {
    store.set(SK.Mode, 'plan');
    const tc = { id: '1', type: 'function' as const, function: { name: 'write_file_content', arguments: '{}' } };
    assert.equal(taskPlanPlugin.onBeforeToolCall!(tc), null);
  });

  test('onBeforeToolCall plan mode 放行 plan_write', async () => {
    store.set(SK.Mode, 'plan');
    const tc = { id: '2', type: 'function' as const, function: { name: 'plan_write', arguments: '{}' } };
    assert.notEqual(taskPlanPlugin.onBeforeToolCall!(tc), null);
  });

  test('onBeforeToolCall normal mode 放行所有工具', async () => {
    store.set(SK.Mode, 'normal');
    const tc = { id: '3', type: 'function' as const, function: { name: 'write_file_content', arguments: '{}' } };
    assert.notEqual(taskPlanPlugin.onBeforeToolCall!(tc), null);
  });
});
