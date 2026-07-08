import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { taskPlanPlugin } from '../src/plugins/tools/task-plan.js';
import { ToolContext } from '../src/core/contract.js';
import { SK } from '../src/core/store-keys.js';

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

function getPlanFilePath(): string {
  return path.join(process.cwd(), '.nano-code', 'plan.md');
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

  test('enter_plan_mode 返回包含计划文件路径的提示', async () => {
    const res = await taskPlanPlugin.execute('enter_plan_mode', {}, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('.nano-code/plan.md'));
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
    store = createTestStore();
    store.set(SK.Mode, 'plan');
    await taskPlanPlugin.onInit!({
      store,
      getPluginConfig: () => ({}),
    } as any);
  });

  afterEach(() => {
    (process.cwd as any) = origCwd;
    removeTempDir(tmpDir);
  });

  test('exit_plan_mode 无计划文件时报错', async () => {
    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('No plan found'));
  });

  test('exit_plan_mode 有计划文件时调用 confirmCallback', async () => {
    // Write plan file
    const planDir = path.join(tmpDir, '.nano-code');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(getPlanFilePath(), '1. Refactor utils\n2. Add tests', 'utf-8');

    let confirmCalled = false;
    const ctxWithConfirm: ToolContext = {
      ...CTX,
      confirmCallback: async (req) => {
        confirmCalled = true;
        assert(req.message.includes('Exit plan mode'));
        assert(req.details?.includes('Refactor utils'));
        return true; // approve
      },
    };

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, ctxWithConfirm);
    assert.equal(res.status, 'success');
    assert(confirmCalled, 'confirmCallback should have been called');
    // Mode should be back to normal
    assert.equal(store.get(SK.Mode), 'normal');
  });

  test('exit_plan_mode 用户拒绝后保持 plan 模式', async () => {
    const planDir = path.join(tmpDir, '.nano-code');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(getPlanFilePath(), 'Some plan', 'utf-8');

    let confirmCalled = false;
    const ctxWithConfirm: ToolContext = {
      ...CTX,
      confirmCallback: async () => {
        confirmCalled = true;
        return false; // reject
      },
    };

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, ctxWithConfirm);
    assert.equal(res.status, 'rejected_by_user');
    assert(confirmCalled);
    // Mode should remain plan
    assert.equal(store.get(SK.Mode), 'plan');
  });

  test('exit_plan_mode 恢复 PrePlanMode', async () => {
    const planDir = path.join(tmpDir, '.nano-code');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(getPlanFilePath(), 'Test plan', 'utf-8');

    store.set(SK.PrePlanMode, 'custom-mode');
    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, {
      ...CTX,
      confirmCallback: async () => true,
    });
    assert.equal(res.status, 'success');
    assert.equal(store.get(SK.Mode), 'custom-mode');
    assert.equal(store.get(SK.PrePlanMode), undefined);
  });

  test('exit_plan_mode 无 PrePlanMode 时恢复 normal', async () => {
    const planDir = path.join(tmpDir, '.nano-code');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(getPlanFilePath(), 'Plan content', 'utf-8');

    const res = await taskPlanPlugin.execute('exit_plan_mode', {}, {
      ...CTX,
      confirmCallback: async () => true,
    });
    assert.equal(res.status, 'success');
    assert.equal(store.get(SK.Mode), 'normal');
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
