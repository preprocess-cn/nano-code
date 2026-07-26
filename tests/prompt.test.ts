import { describe, it } from 'vitest';
import * as assert from 'node:assert/strict';
import { formatToolResponse } from '../src/core/prompt.js';

describe('formatToolResponse', () => {
  it('includes status and data on success', () => {
    const r = JSON.parse(formatToolResponse({ status: 'success', data: 'ok' }));
    assert.equal(r.status, 'success');
    assert.equal(r.data, 'ok');
  });

  it('includes message on success when provided', () => {
    const r = JSON.parse(formatToolResponse({ status: 'success', message: 'done' }));
    assert.equal(r.message, 'done');
  });

  it('appends environment snapshot on error', () => {
    const r = JSON.parse(formatToolResponse({ status: 'error', message: 'boom' }));
    assert.ok(r.message.includes('[System Environment Snapshot]'));
    assert.ok(r.message.includes('boom'));
  });

  it('appends environment snapshot for rejected_by_user', () => {
    const r = JSON.parse(formatToolResponse({ status: 'rejected_by_user', message: 'nope' }));
    assert.ok(r.message.includes('[System Environment Snapshot]'));
    assert.ok(r.message.includes('nope'));
  });

  it('appends environment snapshot even when error message is empty', () => {
    const r = JSON.parse(formatToolResponse({ status: 'error' }));
    assert.ok(r.message!.includes('[System Environment Snapshot]'));
  });

  it('output is valid JSON', () => {
    const raw = formatToolResponse({ status: 'success', data: 'hello' });
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});
