import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import React from 'react';
import { StatusBar } from '../src/plugins/display/claude-code-ink/components/StatusBar.js';

/**
 * Walk the React element tree and return all text strings found in Text components.
 */
function extractText(element: React.ReactElement | null): string[] {
  if (!element) return [];

  const results: string[] = [];
  const stack: any[] = [element];

  while (stack.length > 0) {
    const node = stack.pop();

    // node is a React element: { type, props: { children, ... }, key }
    if (!node || typeof node !== 'object') continue;

    const { type, props } = node as any;
    if (!props) continue;

    // Check children for text
    if (props.children) {
      if (typeof props.children === 'string') {
        results.push(props.children);
      } else if (Array.isArray(props.children)) {
        // Push children onto stack in reverse order for correct processing
        for (let i = props.children.length - 1; i >= 0; i--) {
          stack.push(props.children[i]);
        }
      } else if (React.isValidElement(props.children)) {
        stack.push(props.children);
      }
    }
  }

  return results;
}

describe('StatusBar', () => {
  it('renders "● PLAN" when mode is plan', () => {
    const tree = StatusBar({ segments: { mode: 'plan' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('● PLAN')), `Expected "● PLAN" in ${JSON.stringify(texts)}`);
  });

  it('renders "(Shift+Tab)" hint when mode is plan', () => {
    const tree = StatusBar({ segments: { mode: 'plan' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('Shift+Tab')), `Expected "(Shift+Tab)" in ${JSON.stringify(texts)}`);
  });

  it('renders mode value as plain text when mode is non-plan string', () => {
    const tree = StatusBar({ segments: { mode: 'normal' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('normal')), `Expected "normal" in ${JSON.stringify(texts)}`);
    assert.ok(!texts.some(t => t.includes('● PLAN')), 'Should not contain "● PLAN"');
  });

  it('renders nothing (null) when mode is undefined and no other segments', () => {
    const tree = StatusBar({ segments: {} });
    assert.equal(tree, null);
  });

  it('renders regular segments as KEY: VALUE', () => {
    const tree = StatusBar({ segments: { mode: 'plan', tasks: '3 active' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('tasks')), `Expected "tasks" in ${JSON.stringify(texts)}`);
  });

  it('renders notification text on the right side', () => {
    const tree = StatusBar({
      segments: {},
      notification: { source: 'cron', message: 'Task done' },
    });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('[cron]')), `Expected "[cron]" in ${JSON.stringify(texts)}`);
    assert.ok(texts.some(t => t.includes('Task done')), `Expected "Task done" in ${JSON.stringify(texts)}`);
  });

  it('renders both mode plan and notification simultaneously', () => {
    const tree = StatusBar({
      segments: { mode: 'plan' },
      notification: { source: 'cron', message: 'done' },
    });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('● PLAN')), 'Contains ● PLAN');
    assert.ok(texts.some(t => t.includes('Shift+Tab')), 'Contains (Shift+Tab)');
    assert.ok(texts.some(t => t.includes('[cron]')), 'Contains [cron]');
  });

  it('returns null when no segments and no notification', () => {
    const tree = StatusBar({ segments: {}, notification: null });
    assert.equal(tree, null);
  });
});
