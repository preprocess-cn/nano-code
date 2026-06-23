import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ThinkStream } from '../src/plugins/display/think-stream.js';

describe('ThinkStream', () => {
  it('hides text without </think>', () => {
    const s = new ThinkStream();
    assert.equal(s.next('Hello World'), '');
  });

  it('strips everything before </think> and returns the rest', () => {
    const s = new ThinkStream();
    assert.equal(s.next('X<think>hidden</think>Y'), 'Y');
  });

  it('returns visible content after </think>', () => {
    const s = new ThinkStream();
    assert.equal(s.next('a<think>b</think>c'), 'c');
  });

  it('passes through chunks after </think> was found', () => {
    const s = new ThinkStream();
    assert.equal(s.next('a<think>b</think>c'), 'c');
    assert.equal(s.next('d'), 'd');
    assert.equal(s.next('e'), 'e');
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
    assert.equal(s.next('D'), '');
  });
});
