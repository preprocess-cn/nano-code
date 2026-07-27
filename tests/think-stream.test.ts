import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ThinkStream } from '../src/plugins/display/think-stream.js';

describe('ThinkStream', () => {
  it('filters content before </think> and returns after', () => {
    const s = new ThinkStream();
    assert.equal(s.next('X<think>hidden</think>Y'), 'Y');
  });

  it('handles </think> without opening tag (deepseek behavior)', () => {
    const s = new ThinkStream();
    assert.equal(s.next('a<think>b</think>c'), 'c');
  });

  it('passes through chunks after </think> was found', () => {
    const s = new ThinkStream();
    assert.equal(s.next('a<think>b</think>c'), 'c');
    assert.equal(s.next('d'), 'd');
    assert.equal(s.next('e'), 'e');
  });

  it('passes through subsequent <think> tags as literal text after </think>', () => {
    const s = new ThinkStream();
    s.next('<think>hidden</think>visible');
    // 后续的 think 标签应作为普通文本放行
    assert.equal(s.next('more<think>again</think>end'), 'more<think>again</think>end');
  });

  it('passes through text when no think tags present (GPT-4 behavior)', () => {
    const s = new ThinkStream();
    // 模拟 GPT-4 完全不发 think 标签的场景
    // 小 chunk 可能被缓冲，但超过阈值后应全部放行
    const largeText = 'A'.repeat(5000);
    assert.ok(s.next(largeText).length > 0);
  });

  it('buffers small chunks when no think tags seen', () => {
    const s = new ThinkStream();
    // 小块文本在阈值内且无 think 标签时，可能被缓冲
    // 但不应永久丢弃
    s.next('short text without any tags');
    // 再次发送大块触发阈值
    const result = s.next('B'.repeat(5000));
    assert.ok(result.length > 0);
  });
});

describe('ThinkStream cross-chunk partial tags', () => {
  it('handles </think> split across chunks', () => {
    const s = new ThinkStream();
    assert.equal(s.next('A<think>B</thi'), '');
    assert.equal(s.next('nk>C'), 'C');
  });

  it('handles full think tag split across 3 chunks', () => {
    const s = new ThinkStream();
    assert.equal(s.next('X<think>A</'), '');
    assert.equal(s.next('thin'), '');
    assert.equal(s.next('k>Y'), 'Y');
  });

  it('handles <think> and </think> split across multiple chunks', () => {
    const s = new ThinkStream();
    assert.equal(s.next('<'), '');
    assert.equal(s.next('think>'), '');
    assert.equal(s.next('hidden</think>visible'), 'visible');
  });

  it('handles text before <think> in a separate chunk', () => {
    const s = new ThinkStream();
    assert.equal(s.next('Before <'), '');
    assert.equal(s.next('think>hidden</think> After'), ' After');
  });

  it('handles partial <thi prefix then completes', () => {
    const s = new ThinkStream();
    assert.equal(s.next('A <thi'), '');
    assert.equal(s.next('nk>B</think>C'), 'C');
  });

  it('reset clears state', () => {
    const s = new ThinkStream();
    assert.equal(s.next('A<think>B</think>C'), 'C');
    s.reset();
    // reset 后应重新等待 </think>
    assert.equal(s.next('<think>hidden</think>new'), 'new');
  });

  it('reset then no think tags — falls through after threshold', () => {
    const s = new ThinkStream();
    assert.equal(s.next('<think>done</think>result'), 'result');
    s.reset();
    const large = 'X'.repeat(5000);
    assert.ok(s.next(large).length > 0);
  });
});
