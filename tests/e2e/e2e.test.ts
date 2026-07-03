import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NanoCodeAgent } from '#src/core/agent.js';
import { PluginRegistry } from '#src/core/plugin.js';
import { registerBuiltinPlugin } from '#src/core/plugin.js';
import { SK } from '#src/core/store-keys.js';
import { StubLLMClient, createSpyDisplay, createToolCall, getMemoryProjectDir } from './e2e-helper.js';

describe('E2E — ReAct 循环全链路', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-'));
    mock.method(process, 'cwd', () => tmpDir);
  });

  afterEach(() => {
    mock.restoreAll();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    // Clean up memory plugin project dir if any
    const memDir = getMemoryProjectDir(tmpDir);
    if (fs.existsSync(memDir)) {
      fs.rmSync(memDir, { recursive: true, force: true });
    }
  });

  // ── Scenario 1: 基本单工具流 ──

  it('场景 1: 基本单工具流 — write_file → 结果回注 → 最终回复', async () => {
    const registry = new PluginRegistry();
    registry.setDefaultContext({ skipPermission: true });
    await registerBuiltinPlugin(registry, 'fs');

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('write_file_content', { path: 'hello.txt', content: 'Hello World' })],
      },
      { text: 'File created.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('write a hello file');

    assert.equal(result, 'File created.');

    // 文件已写入磁盘
    assert.equal(fs.existsSync(path.join(tmpDir, 'hello.txt')), true);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8'), 'Hello World');

    // History 结构：user → assistant(tool_call) → tool(result) → assistant(final)
    const history = agent.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
    assert.ok(history[1].tool_calls);
    assert.equal(history[2].role, 'tool');
    assert.ok(history[2].content?.includes('success'));
    assert.equal(history[3].role, 'assistant');
    assert.equal(history[3].content, 'File created.');

    // Display 事件
    assert.equal(events.toolCalls.length, 1);
    assert.equal(events.toolCalls[0].toolName, 'write_file_content');
    assert.equal(events.toolResults.length, 1);
    assert.equal(events.toolResults[0].status, 'success');
    assert.equal(events.turnStarts, 1);
    assert.equal(events.turnEnds, 1);

    // LLM 被调用 2 次
    assert.equal(stub.callCount, 2);
  });

  // ── Scenario 2: 多工具多轮流 ──

  it('场景 2: 多工具多轮流 — write 后再 read，两个 LLM 轮次', async () => {
    const registry = new PluginRegistry();
    registry.setDefaultContext({ skipPermission: true });
    await registerBuiltinPlugin(registry, 'fs');

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('write_file_content', { path: 'data.txt', content: 'stored data' })],
      },
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('view_file_content', { path: 'data.txt' }, 'e2e_call_2')],
      },
      { text: 'Write and verified.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('create data.txt then read it');

    assert.equal(result, 'Write and verified.');

    // 文件存在
    assert.equal(fs.readFileSync(path.join(tmpDir, 'data.txt'), 'utf-8'), 'stored data');

    // History: user → asst(tc1) → tool1 → asst(tc2) → tool2 → asst(final)
    const history = agent.getHistory();
    assert.equal(history.length, 6);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
    assert.ok(history[1].tool_calls, 'first assistant msg should have tool_calls');
    assert.equal(history[1].tool_calls![0].function.name, 'write_file_content');
    assert.equal(history[2].role, 'tool');
    assert.ok(history[2].content?.includes('success'), 'tool result should contain success');

    assert.equal(history[3].role, 'assistant');
    assert.ok(history[3].tool_calls, 'second assistant msg should have tool_calls');
    assert.equal(history[3].tool_calls![0].function.name, 'view_file_content');
    assert.equal(history[4].role, 'tool');
    assert.ok(history[4].content?.includes('success'), 'second tool result should contain success');
    // 第二个 tool result 包含文件内容
    assert.ok(history[4].content?.includes('stored data'));

    assert.equal(history[5].role, 'assistant');
    assert.equal(history[5].content, 'Write and verified.');

    // Display 事件
    assert.equal(events.toolCalls.length, 2);
    assert.equal(events.toolCalls[0].toolName, 'write_file_content');
    assert.equal(events.toolCalls[1].toolName, 'view_file_content');
    assert.equal(events.toolResults.length, 2);

    // LLM 被调用 3 次
    assert.equal(stub.callCount, 3);

    // LLM 第二次调用时看到了第一次 tool 的结果
    assert.ok(stub.receivedMessages[1]?.some(m => m.role === 'tool'));
  });

  // ── Scenario 3: 工具错误处理 ──

  it('场景 3: 工具错误处理 — 读不存在的文件，错误回注 LLM', async () => {
    const registry = new PluginRegistry();
    await registerBuiltinPlugin(registry, 'fs');

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('view_file_content', { path: 'nonexistent.txt' })],
      },
      { text: 'The file was not found. I should create it.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('read nonexistent.txt');

    assert.equal(result, 'The file was not found. I should create it.');

    // History 结构正常，不抛异常
    const history = agent.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[2].role, 'tool');
    assert.ok(history[2].content?.includes('error'));

    // Display 事件中 status 为 error
    assert.equal(events.toolResults.length, 1);
    assert.equal(events.toolResults[0].status, 'error');
  });

  // ── Scenario 4: 权限门 ──

  it('场景 4a: 权限门 — 批准后工具执行', async () => {
    const registry = new PluginRegistry();
    await registerBuiltinPlugin(registry, 'fs');
    registry.setConfirmCallback(async () => true);

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('write_file_content', { path: 'approved.txt', content: 'approved data' })],
      },
      { text: 'User approved the write.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('write approved file');

    assert.equal(result, 'User approved the write.');
    assert.equal(fs.readFileSync(path.join(tmpDir, 'approved.txt'), 'utf-8'), 'approved data');
    assert.equal(events.toolResults[0].status, 'success');
  });

  it('场景 4b: 权限门 — 拒绝后工具不执行', async () => {
    const registry = new PluginRegistry();
    await registerBuiltinPlugin(registry, 'fs');
    registry.setConfirmCallback(async () => false);

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('write_file_content', { path: 'rejected.txt', content: 'should not appear' })],
      },
      { text: 'User rejected the operation.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    await agent.runTask('write rejected file');

    // 文件没有被创建
    assert.equal(fs.existsSync(path.join(tmpDir, 'rejected.txt')), false);
    // Tool result 状态为 rejected_by_user
    assert.equal(events.toolResults[0].status, 'rejected_by_user');
  });

  // ── Scenario 5: 取消 ──

  it('场景 5a: 取消 — 预置 cancellation flag，LLM 不会被调用', async () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentCancelled, true);

    let llmCalled = false;
    const stub = {
      sendSystemMessage: async () => {
        llmCalled = true;
        return { text: 'should not happen', stopReason: 'stop' };
      },
      getModel: () => 'e2e-stub',
    };

    const agent = new NanoCodeAgent({ registry, llmClient: stub as any });
    const result = await agent.runTask('should not run');

    assert.equal(llmCalled, false);
    assert.equal(result, undefined);
    assert.equal(registry.store.get(SK.AgentCancelled), undefined); // 标志被清除
  });

  it('场景 5b: 取消 — 通过 AbortController 中断 LLM 调用', async () => {
    const registry = new PluginRegistry();
    const ac = new AbortController();
    ac.abort(); // 预先中止

    const stub = new StubLLMClient([
      { text: 'should not be reached', stopReason: 'stop' },
    ]);

    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, abortController: ac });
    const result = await agent.runTask('should abort');

    assert.equal(result, undefined);
    assert.equal(stub.callCount, 0); // LLM 调用抛出 AbortError
  });

  // ── Scenario 6: 记忆插件 ──

  it('场景 6: 记忆插件 — save_memory 后 recall_memory 跨轮次', async () => {
    const registry = new PluginRegistry();
    await registerBuiltinPlugin(registry, 'memory', {});
    registry.allowTool('save_memory');

    const content = 'User prefers TypeScript';
    const title = 'language preference';
    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('save_memory', { content, title, tags: ['preference'] })],
      },
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('recall_memory', { query: 'TypeScript' }, 'e2e_call_2')],
      },
      { text: 'Memory test complete.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('save and recall memory');

    assert.equal(result, 'Memory test complete.');

    // History 结构完整
    const history = agent.getHistory();
    assert.equal(history.length, 6);

    // 第一个 tool result 是保存成功
    assert.ok(history[2].content?.includes('记忆已保存'));

    // 第二个 tool result 包含原始内容
    assert.ok(history[4].content?.includes(content));

    // 记忆文件在磁盘上生成
    const memDir = getMemoryProjectDir(tmpDir);
    const memFile = path.join(memDir, 'memories', 'language-preference.md');
    assert.equal(fs.existsSync(memFile), true);
    assert.ok(fs.readFileSync(memFile, 'utf-8').includes(content));

    // MEMORY.md 索引存在
    assert.equal(fs.existsSync(path.join(memDir, 'MEMORY.md')), true);

    // Display 事件
    assert.equal(events.toolCalls.length, 2);
  });

  // ── Scenario 8: 并发只读工具执行 ──

  it('场景 8: 并发只读工具执行 — 同轮两个 view_file_content 并行', async () => {
    const registry = new PluginRegistry();
    registry.setDefaultContext({ skipPermission: true });
    await registerBuiltinPlugin(registry, 'fs');

    // 创建两个测试文件
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'FILE_A');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'FILE_B');

    // LLM 一轮返回两个 read-only 工具调用
    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [
          createToolCall('view_file_content', { path: 'a.txt' }, 'call_read_a'),
          createToolCall('view_file_content', { path: 'b.txt' }, 'call_read_b'),
        ],
      },
      { text: 'Both files read.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('read both files');

    assert.equal(result, 'Both files read.');

    // History: user → asst(tc1+tc2) → tool1 → tool2 → asst(final)
    const history = agent.getHistory();
    assert.equal(history.length, 5);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
    assert.ok(history[1].tool_calls);
    assert.equal(history[1].tool_calls!.length, 2);

    // 两个 tool result 都存在
    const toolRoles = history.filter(m => m.role === 'tool');
    assert.equal(toolRoles.length, 2);
    assert.ok(toolRoles[0].content?.includes('FILE_A') || toolRoles[0].content?.includes('FILE_B'));
    assert.ok(toolRoles[1].content?.includes('FILE_A') || toolRoles[1].content?.includes('FILE_B'));

    // Display 事件：两个工具都被调用
    assert.equal(events.toolCalls.length, 2);
    assert.equal(events.toolCalls[0].toolName, 'view_file_content');
    assert.equal(events.toolCalls[1].toolName, 'view_file_content');
    assert.equal(events.toolResults.length, 2);

    // LLM 只被调用 2 次（不是 3 次 — 两个工具并行不额外增加轮次）
    assert.equal(stub.callCount, 2);
  });

  it('场景 9: 混合并行 — 只读工具并行 + 写入工具串行', async () => {
    const registry = new PluginRegistry();
    registry.setDefaultContext({ skipPermission: true });
    await registerBuiltinPlugin(registry, 'fs');

    // 两个只读 + 一个写入，同轮混合
    fs.writeFileSync(path.join(tmpDir, 'ref.txt'), 'REFERENCE');

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [
          createToolCall('view_file_content', { path: 'ref.txt' }, 'call_read_ref'),
          createToolCall('write_file_content', { path: 'out.txt', content: 'WRITTEN' }, 'call_write'),
          createToolCall('view_file_content', { path: 'ref.txt' }, 'call_read_ref2'),
        ],
      },
      { text: 'Read and wrote.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('read ref and write out');

    assert.equal(result, 'Read and wrote.');

    // 文件写入成功
    assert.equal(fs.existsSync(path.join(tmpDir, 'out.txt')), true);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'out.txt'), 'utf-8'), 'WRITTEN');

    // History 应有 3 个 tool result（两个只读并行 + 一个串行写入）
    const history = agent.getHistory();
    const toolRoles = history.filter(m => m.role === 'tool');
    assert.equal(toolRoles.length, 3);

    // Display 事件：3 个工具调用
    assert.equal(events.toolCalls.length, 3);
    assert.equal(events.toolResults.length, 3);
  });

  // ── Scenario 7: 工具参数缺失 ──

  it('场景 7: 工具参数缺失 — write_file 缺少 path，错误回注 LLM', async () => {
    const registry = new PluginRegistry();
    await registerBuiltinPlugin(registry, 'fs');
    registry.allowTool('write_file_content');

    const stub = new StubLLMClient([
      {
        text: null, stopReason: 'tool_use',
        toolCalls: [createToolCall('write_file_content', { content: 'missing path param' })],
      },
      { text: 'I need to provide a path parameter.', stopReason: 'stop' },
    ]);

    const { display, events } = createSpyDisplay();
    const agent = new NanoCodeAgent({ registry, llmClient: stub as any, display });
    const result = await agent.runTask('write a file without path');

    assert.equal(result, 'I need to provide a path parameter.');

    // 没有文件被写
    const history = agent.getHistory();
    assert.equal(history.length, 4);
    assert.equal(history[2].role, 'tool');
    assert.ok(history[2].content?.includes('error'));

    // Tool result 状态为 error
    assert.equal(events.toolResults.length, 1);
    assert.equal(events.toolResults[0].status, 'error');
  });
});
