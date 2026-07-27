import { describe, it } from 'vitest';
import * as assert from 'node:assert/strict';
import { AgentTracker } from '../src/plugins/display/claude-code-ink/agent-tracker.js';

describe('AgentTracker — per-agent token', () => {

  it('startAgent creates state with tokens=0', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1', 'search for the function');
    const state = tracker.states.get('explore_sync_x1');
    assert.ok(state, 'state should exist');
    assert.equal(state!.tokens, 0);
    assert.equal(state!.status, 'running');
    assert.equal(state!.type, 'explore');
    assert.equal(state!.toolUseCount, 0);
  });

  it('updateToolCall sets state.tokens from tokens parameter', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    tracker.updateToolCall('explore_sync_x1', 'search_code', 300);
    const state = tracker.states.get('explore_sync_x1');
    assert.equal(state!.tokens, 300);
    assert.equal(state!.toolUseCount, 1);
    assert.equal(state!.lastToolName, 'search_code');
  });

  it('updateToolCall increments toolUseCount on multiple calls', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    tracker.updateToolCall('explore_sync_x1', 'search_code', 150);
    tracker.updateToolCall('explore_sync_x1', 'read_file', 350);
    const state = tracker.states.get('explore_sync_x1');
    assert.equal(state!.tokens, 350);
    assert.equal(state!.toolUseCount, 2);
  });

  it('updateToolCall with no tokens param keeps previous value', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    tracker.updateToolCall('explore_sync_x1', 'search_code', 200);
    tracker.updateToolCall('explore_sync_x1', 'read_file');
    const state = tracker.states.get('explore_sync_x1');
    assert.equal(state!.tokens, 200, 'should keep previous token value');
    assert.equal(state!.toolUseCount, 2);
  });

  it('endAgent sets final tokens and status', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    tracker.updateToolCall('explore_sync_x1', 'search_code', 300);
    const result = tracker.endAgent('explore_sync_x1', 350);
    assert.ok(result, 'should return result');
    const state = tracker.states.get('explore_sync_x1');
    assert.equal(state!.status, 'completed');
    assert.equal(state!.tokens, 350);
    assert.ok(state!.endTime, 'endTime should be set');
    assert.ok(result!.elapsedMs >= 0, 'elapsedMs should be >= 0');
  });

  it('endAgent returns null for non-existent agent', () => {
    const tracker = new AgentTracker();
    const result = tracker.endAgent('nonexistent');
    assert.equal(result, null);
  });

  it('endAgent returns null if called twice (already completed)', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    const r1 = tracker.endAgent('explore_sync_x1', 500);
    assert.ok(r1, 'first call should succeed');
    const r2 = tracker.endAgent('explore_sync_x1');
    assert.equal(r2, null, 'second call should return null');
  });

  it('multiple agents tracked independently', () => {
    const tracker = new AgentTracker();
    tracker.startAgent('explore_sync_x1');
    tracker.startAgent('general_bg_y2');

    tracker.updateToolCall('explore_sync_x1', 'search_code', 100);
    tracker.updateToolCall('general_bg_y2', 'write_file', 200);

    const s1 = tracker.states.get('explore_sync_x1')!;
    const s2 = tracker.states.get('general_bg_y2')!;

    assert.equal(s1.tokens, 100);
    assert.equal(s1.toolUseCount, 1);
    assert.equal(s2.tokens, 200);
    assert.equal(s2.toolUseCount, 1);
  });

  it('updateToolCall returns early for unknown agent (no crash)', () => {
    const tracker = new AgentTracker();
    // Should not throw
    tracker.updateToolCall('nonexistent', 'some_tool', 100);
    assert.ok(true, 'should not crash');
  });
});
