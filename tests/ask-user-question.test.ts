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

describe('AskUserQuestion 插件 — 参数校验', () => {
  /** 参数校验在 handler 查找之前执行，不需要 registry */
  let registry: PluginRegistry;

  beforeEach(async () => {
    registry = new PluginRegistry();
    await registry.register(askUserQuestionPlugin);
  });

  test('缺少 questions 返回错误', async () => {
    const res = await registry.execute('ask_user_question', {}, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('至少一个问题'));
  });

  test('空 questions 数组返回错误', async () => {
    const res = await registry.execute('ask_user_question', { questions: [] }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('至少一个问题'));
  });

  test('超过 4 个问题返回错误', async () => {
    const q = { question: '测试？', header: '测试', options: [{ label: 'A', description: 'Desc A' }, { label: 'B', description: 'Desc B' }] };
    const res = await registry.execute('ask_user_question', { questions: [q, q, q, q, q] }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('最多'));
  });

  test('缺少 question/header/options 返回错误', async () => {
    const res = await registry.execute('ask_user_question', {
      questions: [{ header: 'No question', options: [{ label: 'A', description: 'B' }] }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('必须包含'));
  });

  test('少于 2 个选项返回错误', async () => {
    const res = await registry.execute('ask_user_question', {
      questions: [{ question: '测试？', header: '测试', options: [{ label: 'Only', description: 'Only one' }] }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('2-4 个选项'));
  });

  test('超过 4 个选项返回错误', async () => {
    const res = await registry.execute('ask_user_question', {
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
    const res = await registry.execute('ask_user_question', {
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
    const res = await registry.execute('ask_user_question', {
      questions: [{
        question: '这是什么',
        header: '测试',
        options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }],
      }],
    }, CTX);
    assert.equal(res.status, 'error');
    assert(res.message?.includes('问号'));
  });

  test('question 以 ? 结尾可以接受（无 handler 时回退为结构化输出）', async () => {
    const res = await registry.execute('ask_user_question', {
      questions: [{
        question: 'What DB?',
        header: 'DB',
        options: [{ label: 'Pg', description: 'PostgreSQL' }, { label: 'Mg', description: 'MongoDB' }],
      }],
    }, CTX);
    // No interactive handler registered — should return success with structured data (fallback)
    assert.equal(res.status, 'success');
    assert(res.data?.includes('交互式提问'));
    assert(res.data?.includes('What DB?'));
  });
});

describe('AskUserQuestion 插件 — 回调集成（通过 registry）', () => {
  let registry: PluginRegistry;

  beforeEach(async () => {
    registry = new PluginRegistry();
    await registry.register(askUserQuestionPlugin);
  });

  test('无 handler 时回退为结构化数据输出', async () => {
    const res = await registry.execute('ask_user_question', { questions: VALID_QUESTIONS }, CTX);
    assert.equal(res.status, 'success');
    assert(res.data?.includes('交互式提问'));
    assert(res.data?.includes('PostgreSQL'));
  });

  test('注册 handler 后调用并返回 answers', async () => {
    registry.registerInteractiveHandler('ask_user_question', async (args: any) => {
      assert.equal(args.questions.length, 1);
      assert.equal(args.questions[0].header, '数据库');
      return { status: 'success', data: JSON.stringify({
        questions: args.questions,
        answers: { [args.questions[0].question]: 'PostgreSQL' },
      })};
    });

    const res = await registry.execute('ask_user_question', { questions: VALID_QUESTIONS }, CTX);
    assert.equal(res.status, 'success');
    const data = JSON.parse(res.data!);
    assert.deepEqual(data.answers, { '使用什么数据库？': 'PostgreSQL' });
    assert.equal(data.questions.length, 1);
  });

  test('多个问题调用 handler', async () => {
    const questions = [
      { question: '语言？', header: '语言', options: [{ label: 'TS', description: 'TypeScript' }, { label: 'JS', description: 'JavaScript' }] },
      { question: '框架？', header: '框架', options: [{ label: 'React', description: 'UI 框架' }, { label: 'Vue', description: '渐进式框架' }] },
    ];

    registry.registerInteractiveHandler('ask_user_question', async (args: any) => {
      return { status: 'success', data: JSON.stringify({
        questions: args.questions,
        answers: { '语言？': 'TS', '框架？': 'React' },
      })};
    });

    const res = await registry.execute('ask_user_question', { questions }, CTX);
    assert.equal(res.status, 'success');
    const data = JSON.parse(res.data!);
    assert.equal(data.answers['语言？'], 'TS');
    assert.equal(data.answers['框架？'], 'React');
  });
});

describe('AskUserQuestion 插件 — PluginRegistry 集成', () => {
  test('注册后工具列表包含 ask_user_question', async () => {
    const r = new PluginRegistry();
    await r.register(askUserQuestionPlugin);
    const schemas = r.getAllSchemas();
    const qTool = schemas.find(s => s.function.name === 'ask_user_question');
    assert.ok(qTool, 'ask_user_question 工具应已注册');
    assert.equal(qTool!.function.sideEffect, false);
  });

  test('registerInteractiveHandler 后 getInteractiveHandler 返回 handler', async () => {
    const r = new PluginRegistry();
    const handler = async () => ({ status: 'success' as const, data: 'ok' });
    r.registerInteractiveHandler('ask_user_question', handler);
    assert.equal(r.getInteractiveHandler('ask_user_question'), handler);
  });

  test('未注册 handler 时 getInteractiveHandler 返回 undefined', async () => {
    const r = new PluginRegistry();
    assert.equal(r.getInteractiveHandler('nonexistent'), undefined);
  });
});
