import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { askUserQuestionPlugin } from '../src/plugins/tools/ask-user-question.js';
import { ToolContext } from '../src/core/contract.js';
import { PluginRegistry } from '../src/core/plugin.js';

// ── Helpers ──

const CTX: ToolContext = {
  skipPermission: true,
  cwd: process.cwd(),
  defaultTimeout: 30000,
  sideEffect: false,
};

/** In-memory store for testing */
function createTestStore() {
  const data = new Map<string, any>();
  return {
    get: <T>(key: string): T | undefined => data.get(key) as T | undefined,
    set: (key: string, value: any) => { data.set(key, value); },
    data,
  };
}

const VALID_QUESTIONS = [
  {
    question: '使用什么数据库？',
    header: '数据库',
    options: [
      { label: 'PostgreSQL', description: '关系型数据库，支持 ACID' },
      { label: 'MongoDB', description: '文档型数据库，灵活 schema' },
    ],
  },
];

// ── Tests ──

describe('AskUserQuestion 插件 — onInit', () => {
  test('onInit 保存 store 引用', async () => {
    const store = createTestStore();
    await askUserQuestionPlugin.onInit!({ store } as any);
    // No error means success; execute will check store ref
    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions: VALID_QUESTIONS }, CTX);
    assert.equal(res.status, 'error'); // no callback registered
    assert(res.message?.includes('不支持交互式提问'));
  });
});

describe('AskUserQuestion 插件 — 参数校验', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    store = createTestStore();
    await askUserQuestionPlugin.onInit!({ store } as any);
  });

  test('缺少 questions 返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {}, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('至少一个问题'));
  });

  test('空 questions 数组返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions: [] }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('至少一个问题'));
  });

  test('超过 4 个问题返回错误', async () => {
    const q = { question: '测试？', header: '测试', options: [{ label: 'A', description: 'Desc A' }, { label: 'B', description: 'Desc B' }] };
    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions: [q, q, q, q, q] }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('最多'));
  });

  test('缺少 question/header/options 返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{ header: 'No question', options: [{ label: 'A', description: 'B' }] }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('必须包含'));
  });

  test('少于 2 个选项返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{ question: '测试？', header: '测试', options: [{ label: 'Only', description: 'Only one' }] }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('2-4 个选项'));
  });

  test('超过 4 个选项返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{
        question: '测试？',
        header: '测试',
        options: [
          { label: 'A', description: 'A' },
          { label: 'B', description: 'B' },
          { label: 'C', description: 'C' },
          { label: 'D', description: 'D' },
          { label: 'E', description: 'E' },
        ],
      }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('2-4 个选项'));
  });

  test('header 超过 12 字符返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{
        question: '测试？',
        header: '这是一个超长的标签标题测试',
        options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }],
      }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('12 个字符'));
  });

  test('question 不以问号结尾返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{
        question: '这是什么',
        header: '测试',
        options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }],
      }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('问号'));
  });

  test('question 以 ? 结尾可以接受', async () => {
    const store2 = createTestStore();
    await askUserQuestionPlugin.onInit!({ store: store2 } as any);
    const res = await askUserQuestionPlugin.execute('ask_user_question', {
      questions: [{
        question: 'What DB?',
        header: 'DB',
        options: [{ label: 'Pg', description: 'PostgreSQL' }, { label: 'Mg', description: 'MongoDB' }],
      }],
    }, CTX);
    // No callback registered — error about no callback, not about question format
    assert.equal(res.status, 'error');
    assert(res.message?.includes('不支持'));
  });
});

describe('AskUserQuestion 插件 — 回调集成', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(async () => {
    store = createTestStore();
    await askUserQuestionPlugin.onInit!({ store } as any);
  });

  test('无 callback 时返回错误', async () => {
    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions: VALID_QUESTIONS }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('不支持交互式提问'));
  });

  test('调用 callback 并返回 answers', async () => {
    store.set('askQuestions', async (questions: any[]) => {
      assert.equal(questions.length, 1);
      assert.equal(questions[0].header, '数据库');
      return { [questions[0].question]: 'PostgreSQL' };
    });

    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions: VALID_QUESTIONS }, CTX);
    assert.equal(res.status, 'success');
    const data = JSON.parse(res.data!);
    assert.deepEqual(data.answers, { '使用什么数据库？': 'PostgreSQL' });
    assert.equal(data.questions.length, 1);
  });

  test('多个问题调用 callback', async () => {
    const questions = [
      { question: '语言？', header: '语言', options: [{ label: 'TS', description: 'TypeScript' }, { label: 'JS', description: 'JavaScript' }] },
      { question: '框架？', header: '框架', options: [{ label: 'React', description: 'UI 框架' }, { label: 'Vue', description: '渐进式框架' }] },
    ];
    store.set('askQuestions', async (qs: any[]) => {
      return { '语言？': 'TS', '框架？': 'React' };
    });

    const res = await askUserQuestionPlugin.execute('ask_user_question', { questions }, CTX);
    assert.equal(res.status, 'success');
    const data = JSON.parse(res.data!);
    assert.equal(data.answers['语言？'], 'TS');
    assert.equal(data.answers['框架？'], 'React');
  });

  test('PluginRegistry 完整集成：注册后工具可用', async () => {
    const registry = new PluginRegistry();
    await registry.register(askUserQuestionPlugin);
    const schemas = registry.getAllSchemas();
    const qTool = schemas.find(s => s.function.name === 'ask_user_question');
    assert.ok(qTool, 'ask_user_question 工具应已注册');
    assert.equal(qTool!.function.sideEffect, false);
  });
});
