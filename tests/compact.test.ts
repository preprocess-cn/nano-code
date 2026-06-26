import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { extractSummary, formatCompactSummaryMessage, buildCompactUserPrompt, COMPACT_SYSTEM_PROMPT } from '../src/plugins/compact/prompt.js';
import { CompactService } from '../src/plugins/compact/service.js';
import { NanoCodeAgent } from '../src/agent.js';
import { PluginRegistry } from '../src/plugin.js';
import { LLMClient, ChatMessage } from '../src/llm.js';

// ── Helpers ──

function makeMsg(role: ChatMessage['role'], content: string, overrides?: Partial<ChatMessage>): ChatMessage {
  return { role, content, ...overrides };
}

function makeAgent(history?: ChatMessage[]): NanoCodeAgent {
  const registry = new PluginRegistry();
  // Use a mock LLMClient to avoid env var loading
  const mockLLM = {} as LLMClient;
  const agent = new NanoCodeAgent(registry, mockLLM, undefined, undefined, 'test');
  if (history) agent.loadHistory(history);
  return agent;
}

// ── Tests ──

describe('extractSummary', () => {
  it('extracts summary from <summary> tags', () => {
    const raw = '<analysis>some thinking</analysis><summary>the actual summary</summary>';
    assert.equal(extractSummary(raw), 'the actual summary');
  });

  it('handles multiline summary', () => {
    const raw = '<analysis>thinking</analysis><summary>\nline 1\nline 2\n</summary>';
    assert.equal(extractSummary(raw), 'line 1\nline 2');
  });

  it('strips <analysis> when no <summary> tags exist', () => {
    const raw = '<analysis>scratchpad</analysis>actual response text';
    assert.equal(extractSummary(raw), 'actual response text');
  });

  it('returns empty text unchanged', () => {
    assert.equal(extractSummary(''), '');
  });

  it('strips analysis before summary', () => {
    const raw = '<analysis>deep thoughts</analysis>\n\n<summary>key points</summary>\nmore text';
    assert.equal(extractSummary(raw), 'key points');
  });
});

describe('formatCompactSummaryMessage', () => {
  it('wraps summary with header and footer', () => {
    const result = formatCompactSummaryMessage('test summary');
    assert.ok(result.includes('[Previous conversation has been summarized below]'));
    assert.ok(result.includes('test summary'));
    assert.ok(result.includes('continue based on this summary'));
  });
});

describe('buildCompactUserPrompt', () => {
  it('formats messages with role labels', () => {
    const msgs = [
      makeMsg('user', 'hello'),
      makeMsg('assistant', 'hi there'),
    ];
    const result = buildCompactUserPrompt(msgs);
    assert.ok(result.includes('<User>'));
    assert.ok(result.includes('hello'));
    assert.ok(result.includes('</User>'));
    assert.ok(result.includes('<AI Assistant>'));
    assert.ok(result.includes('hi there'));
  });

  it('truncates long messages', () => {
    const longContent = 'x'.repeat(10000);
    const msgs = [makeMsg('user', longContent)];
    const result = buildCompactUserPrompt(msgs);
    // 8000 chars max per message
    assert.ok(result.includes('x'.repeat(8000)));
    assert.ok(!result.includes('x'.repeat(8001)));
  });

  it('handles empty message list', () => {
    const result = buildCompactUserPrompt([]);
    assert.ok(result.includes('analyze and summarize'));
  });
});

// ── CompactService unit tests (no LLM call) ──

describe('CompactService - splitMessages', () => {
  it('splits messages with preserveCount=0', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const history = [
      makeMsg('user', 'q1'),
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'q2'),
      makeMsg('assistant', 'a2'),
    ];
    // Access private method via prototype
    const splitter = (CompactService.prototype as any).splitMessages.bind(service);
    const { toSummarize, toPreserve } = splitter(history, 0);
    assert.equal(toSummarize.length, 4);
    assert.equal(toPreserve.length, 0);
  });

  it('preserves N exchanges', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const history = [
      makeMsg('user', 'q1'),
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'q2'),
      makeMsg('assistant', 'a2'),
      makeMsg('user', 'q3'),
      makeMsg('tool', 'result'),
      makeMsg('assistant', 'a3'),
    ];
    const splitter = (CompactService.prototype as any).splitMessages.bind(service);
    const { toSummarize, toPreserve } = splitter(history, 2);
    // preserve 2 exchanges: q2+a2 and q3+tool+a3 (q2 is the 2nd user)
    assert.equal(toSummarize.length, 2); // q1, a1
    assert.equal(toPreserve.length, 5);  // q2, a2, q3, tool, a3
  });

  it('preserves all when count exceeds exchanges', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const history = [
      makeMsg('user', 'q1'),
      makeMsg('assistant', 'a1'),
    ];
    const splitter = (CompactService.prototype as any).splitMessages.bind(service);
    const { toSummarize, toPreserve } = splitter(history, 5);
    assert.equal(toSummarize.length, 0);
    assert.equal(toPreserve.length, 2);
  });

  it('handles empty history', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const splitter = (CompactService.prototype as any).splitMessages.bind(service);
    const { toSummarize, toPreserve } = splitter([], 2);
    assert.equal(toSummarize.length, 0);
    assert.equal(toPreserve.length, 0);
  });
});

describe('CompactService - stripImages', () => {
  it('removes markdown image with base64 data', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const msgs = [makeMsg('user', 'text ![img](data:image/png;base64,abc123) more')];
    const striptor = (CompactService.prototype as any).stripImages.bind(service);
    const result = striptor(msgs);
    assert.ok(result[0].content?.includes('[image]'));
    assert.ok(!result[0].content?.includes('data:image/png'));
  });

  it('removes inline base64 data URIs', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const msgs = [makeMsg('user', 'prefix data:image/png;base64,abc123def456 suffix')];
    const striptor = (CompactService.prototype as any).stripImages.bind(service);
    const result = striptor(msgs);
    assert.ok(result[0].content?.includes('[image data]'));
    assert.ok(!result[0].content?.includes('base64'));
  });

  it('leaves normal text unchanged', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const msgs = [makeMsg('user', 'just normal text with ![alt](url.png)')];
    const striptor = (CompactService.prototype as any).stripImages.bind(service);
    const result = striptor(msgs);
    assert.equal(result[0].content, msgs[0].content);
  });
});

describe('CompactService - buildBoundaryMarker', () => {
  it('produces valid JSON with type compact_boundary', () => {
    const service = new CompactService({} as LLMClient, new PluginRegistry());
    const builder = (CompactService.prototype as any).buildBoundaryMarker.bind(service);
    const result = builder('test summary', 10);
    assert.equal(result.role, 'system');
    const parsed = JSON.parse(result.content!);
    assert.equal(parsed.type, 'compact_boundary');
    assert.equal(parsed.originalMessageCount, 10);
    assert.ok(parsed.timestamp);
  });
});

describe('CompactService - generateSummary with mock LLM', () => {
  it('extracts summary from mock LLM response', async () => {
    const mockLLM = {
      sendSystemMessage: mock.fn(async () => ({
        text: '<analysis>scratch</analysis><summary>mock summary result</summary>',
        toolCalls: undefined,
        stopReason: 'end_turn',
      })),
    } as unknown as LLMClient;

    const service = new CompactService(mockLLM, new PluginRegistry());
    const generator = (CompactService.prototype as any).generateSummary.bind(service);
    const msgs = [makeMsg('user', 'test question'), makeMsg('assistant', 'test answer')];
    const result = await generator(msgs);
    assert.equal(result, 'mock summary result');
  });

  it('falls back to raw text when no summary tags', async () => {
    const mockLLM = {
      sendSystemMessage: mock.fn(async () => ({
        text: 'plain response without tags',
        toolCalls: undefined,
        stopReason: 'end_turn',
      })),
    } as unknown as LLMClient;

    const service = new CompactService(mockLLM, new PluginRegistry());
    const generator = (CompactService.prototype as any).generateSummary.bind(service);
    const msgs = [makeMsg('user', 'hi')];
    const result = await generator(msgs);
    assert.equal(result, 'plain response without tags');
  });
});

describe('CompactService - dry run', () => {
  it('returns stats without calling LLM', async () => {
    const mockLLM = { sendSystemMessage: mock.fn() } as unknown as LLMClient;
    const service = new CompactService(mockLLM, new PluginRegistry());
    const agent = makeAgent([
      makeMsg('user', 'q1'),
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'q2'),
      makeMsg('assistant', 'a2'),
    ]);

    const result = await service.compact(agent, { dryRun: true });
    assert.equal(result.summary, '');
    assert.equal(result.originalMessageCount, 4);
    // savedTokens may be 0 or negative for very short messages (overhead of boundary+summary)
    assert.equal(typeof result.savedTokens, 'number');
    // LLM should NOT have been called
    assert.equal((mockLLM.sendSystemMessage as any).mock.callCount(), 0);
  });
});

// ── File read cache tests (via the fs plugin) ──

import { addToReadCache, getReadCache } from '../src/plugins/tools/fs.js';

describe('File read cache', () => {
  it('stores entries', () => {
    addToReadCache('/test/file.ts', 'content1');
    const cache = getReadCache();
    assert.ok(cache.some(e => e.path === '/test/file.ts' && e.content === 'content1'));
  });

  it('evicts oldest when over limit', () => {
    // Clear first by reading and removing from internal array
    const entries = getReadCache();
    entries.splice(0, entries.length);
    // Adding 6 entries should evict the oldest
    for (let i = 0; i < 6; i++) {
      addToReadCache(`/file${i}.ts`, `content${i}`);
    }
    const cache = getReadCache();
    assert.equal(cache.length, 5);
    // file0 should be evicted
    assert.ok(!cache.some(e => e.path === '/file0.ts'));
  });

  it('deduplicates by path', () => {
    addToReadCache('/dedup.ts', 'old');
    addToReadCache('/dedup.ts', 'new');
    const cache = getReadCache();
    const entries = cache.filter(e => e.path === '/dedup.ts');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, 'new');
  });

  it('getReadCache returns a copy', () => {
    const cache1 = getReadCache();
    cache1.push({ path: '/fake.ts', content: 'fake', timestamp: Date.now() });
    const cache2 = getReadCache();
    // cache2 should not contain the fake entry
    assert.ok(!cache2.some(e => e.path === '/fake.ts'));
  });
});

// ── /compact command registration tests ──

describe('Builtin command registration', () => {
  it('findBuiltinCommand returns compact command', async () => {
    const { findBuiltinCommand } = await import('../src/plugins/commands/builtin.js');
    const cmd = findBuiltinCommand('compact');
    assert.ok(cmd);
    assert.equal(cmd.name, 'compact');
    assert.ok(cmd.aliases?.includes('compress'));
    assert.ok(cmd.description);
    assert.equal(typeof cmd.handler, 'function');
  });

  it('findBuiltinCommand finds alias compress', async () => {
    const { findBuiltinCommand } = await import('../src/plugins/commands/builtin.js');
    const cmd = findBuiltinCommand('compress');
    assert.ok(cmd);
    assert.equal(cmd.name, 'compact');
  });
});
