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

    if (!node || typeof node !== 'object') continue;

    const { type, props } = node as any;
    if (!props) continue;

    if (props.children) {
      if (typeof props.children === 'string') {
        results.push(props.children);
      } else if (Array.isArray(props.children)) {
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

/**
 * Get visible (non-null) direct children of a Box element as untyped objects.
 */
function getChildren(el: React.ReactElement): any[] {
  const raw = (el as any).props?.children;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((c: any) => React.isValidElement(c));
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

  it('renders mode value as plain text when mode is unknown string', () => {
    const tree = StatusBar({ segments: { mode: 'debug' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('debug')), `Expected "debug" in ${JSON.stringify(texts)}`);
    assert.ok(!texts.some(t => t.includes('● PLAN')), 'Should not contain "● PLAN"');
  });

  it('renders NORMAL (Shift+Tab) when mode is normal', () => {
    const tree = StatusBar({ segments: { mode: 'normal' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('○ NORMAL')), `Expected "○ NORMAL" in ${JSON.stringify(texts)}`);
    assert.ok(texts.some(t => t.includes('Shift+Tab')), `Expected "Shift+Tab" in ${JSON.stringify(texts)}`);
  });

  it('returns a valid element (never null) when mode is undefined and no other segments', () => {
    const tree = StatusBar({ segments: {} });
    assert.ok(React.isValidElement(tree), 'Should be a valid React element');
  });

  it('returns a valid element (never null) when no segments and no notification', () => {
    const tree = StatusBar({ segments: {}, notification: null });
    assert.ok(React.isValidElement(tree), 'Should be a valid React element');
  });

  it('renders regular segments as KEY: VALUE', () => {
    const tree = StatusBar({ segments: { mode: 'plan', tasks: '3 active' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('tasks')), `Expected "tasks" in ${JSON.stringify(texts)}`);
  });

  it('uses | separator between multiple segments', () => {
    const tree = StatusBar({ segments: { tasks: '3 active', tokens: '85K' } });
    const texts = extractText(tree);
    assert.ok(texts.some(t => t.includes('|')), `Expected "|" separator in texts ${JSON.stringify(texts)}`);
    assert.ok(!texts.some(t => t.includes('·')), `Expected no middle-dot in texts ${JSON.stringify(texts)}`);
  });

  describe('layout structure', () => {
    it('renders empty root Box when no segments and no notification', () => {
      const tree = StatusBar({})!;
      assert.equal(getChildren(tree).length, 0, 'should have no visible children');
    });

    it('renders left Box with segments but no spacer or right Box when only left content', () => {
      const tree = StatusBar({ segments: { tasks: '3 active' } })!;
      const children: any[] = getChildren(tree);
      assert.equal(children.length, 1, 'should have 1 child (left Box)');
      assert.equal(children[0].key, 'left');
      assert.equal(children[0].props.flexGrow, 0);
      assert.equal(children[0].props.flexShrink, 0);
    });

    it('renders spacer and right Box when notification present', () => {
      const tree = StatusBar({
        notification: { source: 'test', message: 'hello' },
      })!;
      const children: any[] = getChildren(tree);
      assert.equal(children.length, 2, 'should have 2 children (spacer + right)');
      assert.equal(children[0].key, 'spacer');
      assert.equal(children[0].props.flexGrow, 1);
      assert.equal(children[1].key, 'right');
      assert.equal(children[1].props.flexGrow, 0);
      assert.equal(children[1].props.flexShrink, 0);
    });

    it('renders only left Box when mode=plan with no notification (hint in left)', () => {
      const tree = StatusBar({ segments: { mode: 'plan' } })!;
      const children: any[] = getChildren(tree);
      assert.equal(children.length, 1, 'should have 1 child (left Box only)');
      assert.equal(children[0].key, 'left');
    });

    it('right Box has marginLeft=1', () => {
      const tree = StatusBar({
        notification: { source: 'test', message: 'x' },
      })!;
      const children: any[] = getChildren(tree);
      const rightBox = children.find((c: any) => c.key === 'right');
      assert.equal(rightBox.props.marginLeft, 1);
    });

    it('notification text is inside right Box, not left Box', () => {
      const tree = StatusBar({
        segments: { mode: 'plan', tokens: '85K' },
        notification: { source: 'cron', message: 'done' },
      })!;
      const children: any[] = getChildren(tree);
      const leftBox = children.find((c: any) => c.key === 'left');
      const rightBox = children.find((c: any) => c.key === 'right');

      const leftText = JSON.stringify(extractText(leftBox));
      const rightText = JSON.stringify(extractText(rightBox));

      assert.ok(rightText.includes('[cron]'), `Expected "[cron]" in right Box ${rightText}`);
      assert.ok(!leftText.includes('[cron]'), `Expected no "[cron]" in left Box ${leftText}`);
    });

    it('mode hint is inside left Box (after PLAN indicator)', () => {
      const tree = StatusBar({ segments: { mode: 'plan' } })!;
      const children: any[] = getChildren(tree);
      const leftBox = children.find((c: any) => c.key === 'left');
      const leftText = JSON.stringify(extractText(leftBox));
      assert.ok(leftText.includes('Shift+Tab'), `Expected "(Shift+Tab)" in left Box ${leftText}`);
      assert.ok(leftText.indexOf('● PLAN') < leftText.indexOf('Shift+Tab'),
        `Expected "● PLAN" before "(Shift+Tab)" in ${leftText}`);
    });

    it('mode PLAN indicator is inside left Box', () => {
      const tree = StatusBar({ segments: { mode: 'plan' } })!;
      const children: any[] = getChildren(tree);
      const leftBox = children.find((c: any) => c.key === 'left');
      const leftText = JSON.stringify(extractText(leftBox));
      assert.ok(leftText.includes('● PLAN'), `Expected "● PLAN" in left Box ${leftText}`);
    });
  });
});
