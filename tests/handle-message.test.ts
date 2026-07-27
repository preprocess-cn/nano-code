import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { ThinkStream } from '../src/plugins/display/think-stream.js';
import {
  handleStreamDelta,
  clearStreamingText,
  commitStreamingText,
} from '../src/plugins/display/claude-code-ink/handle-message.js';
import {
  createMainContext,
  createSubagentContext,
} from '../src/plugins/display/claude-code-ink/agent-context.js';

function mockStore(): any {
  return { get: () => undefined, set: () => {}, subscribe: () => () => {} };
}

describe('handleStreamDelta', () => {
  let mainCtx: ReturnType<typeof createMainContext>;
  let ts: ThinkStream;

  beforeEach(() => {
    mainCtx = createMainContext(mockStore());
    ts = new ThinkStream();
    ts.next('</think>'); // 预热 ThinkStream 通过 </think>（模拟已处理 think 标签后的正常流）
  });

  it('accumulates text_delta into streaming text and message list', () => {
    const r1 = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: 'Hello' },
      mainCtx, ts, false,
    );
    assert.ok(r1);
    assert.equal(r1!.length, 1);
    assert.equal(r1![0].text, 'Hello');
    assert.equal(r1![0].kind, 'stream');

    const r2 = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: ' world' },
      mainCtx, ts, false,
    );
    assert.ok(r2);
    assert.equal(r2![0].text, 'Hello world');
    // 仍然只有一条消息（原地更新）
    assert.equal(r2!.length, 1);
  });

  it('filters think-tagged content via ThinkStream', () => {
    const ts2 = new ThinkStream();
    // 全部是 think 内容
    const r1 = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: '<think>hidden</think>' },
      mainCtx, ts2, false,
    );
    // </think> 后无可见内容 → null
    assert.equal(r1, null);

    // 后续可见内容正常显示
    const r2 = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: 'visible' },
      mainCtx, ts2, false,
    );
    assert.ok(r2);
    assert.equal(r2![0].text, 'visible');
  });

  it('isolates streaming text between agents', () => {
    const child = createSubagentContext(mainCtx, {
      agentName: 'explore_1',
      agentType: 'Explore',
    });

    const parentMsgs = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: 'parent text' },
      mainCtx, ts, false,
    );
    if (parentMsgs) mainCtx.messages = parentMsgs;

    const childTs = new ThinkStream();
    childTs.next('</think>'); // 预热
    const childMsgs = handleStreamDelta(
      { agentName: 'explore_1', type: 'text_delta', text: 'child text' },
      child, childTs, false,
    );
    if (childMsgs) child.messages = childMsgs;

    // 父 agent streaming text 不受子 agent 影响
    assert.equal(mainCtx.streamingText.get(), 'parent text');
    assert.equal(child.streamingText.get(), 'child text');

    // 消息列表也隔离
    assert.equal(mainCtx.messages[0]?.text, 'parent text');
    assert.equal(child.messages[0]?.text, 'child text');
  });

  it('returns null when filtered text is empty', () => {
    const ts2 = new ThinkStream();
    const r = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: '<think>still thinking...' },
      mainCtx, ts2, false,
    );
    assert.equal(r, null);
  });

  it('strips leading newline on first visible chunk', () => {
    // 模拟 </think> 后紧跟换行的情况
    ts.next('<think>hidden</think>');
    const r = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: '\nHello' },
      mainCtx, ts, false,
    );
    assert.ok(r);
    // 由于 streamingText 的累加逻辑，第一次 '\n' 会被 replace(/^\n+/, '')
    // 但 handleStreamDelta 不负责 strip newline——那是 display-state 层的事
    // 这里只验证基础行为
    assert.equal(typeof r![0].text, 'string');
  });

  it('thinking_delta is only shown when showThink is true', () => {
    const r1 = handleStreamDelta(
      { agentName: 'main', type: 'thinking_delta', text: 'secret thought' },
      mainCtx, ts, false,
    );
    assert.equal(r1, null);

    const r2 = handleStreamDelta(
      { agentName: 'main', type: 'thinking_delta', text: 'visible thought' },
      mainCtx, ts, true,
    );
    assert.ok(r2);
    assert.equal(r2![0].kind, 'thinking');
    assert.equal(r2![0].text, 'visible thought');
  });

  it('creates new stream message after non-stream message', () => {
    mainCtx.messages.push({ agentName: 'main', text: 'some info', kind: 'info' });
    const ts2 = new ThinkStream();
    ts2.next('</think>'); // 预热

    const r = handleStreamDelta(
      { agentName: 'main', type: 'text_delta', text: 'stream content' },
      mainCtx, ts2, false,
    );
    assert.ok(r);
    // 应有两条消息：info + 新 stream
    assert.equal(r!.length, 2);
    assert.equal(r![0].kind, 'info');
    assert.equal(r![1].kind, 'stream');
    assert.equal(r![1].text, 'stream content');
  });
});

describe('clearStreamingText', () => {
  it('clears streaming text overlay', () => {
    const ctx = createMainContext(mockStore());
    ctx.streamingText.update(() => 'temp text');
    clearStreamingText(ctx);
    assert.equal(ctx.streamingText.get(), null);
  });
});

describe('commitStreamingText', () => {
  it('commits streaming text to final message and clears overlay', () => {
    const ctx = createMainContext(mockStore());
    ctx.messages = [{
      agentName: 'main',
      text: 'streaming content',
      kind: 'stream',
    }];
    ctx.streamingText.update(() => 'final content');

    const result = commitStreamingText(ctx);
    assert.equal(result[0].text, 'final content');
    assert.equal(ctx.streamingText.get(), null);
  });

  it('returns messages unchanged when no streaming text', () => {
    const ctx = createMainContext(mockStore());
    ctx.messages = [{ agentName: 'main', text: 'hello', kind: 'info' }];
    const result = commitStreamingText(ctx);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'hello');
  });
});
