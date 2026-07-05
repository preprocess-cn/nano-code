import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { withRetry } from '../src/core/retry.js';

describe('withRetry', () => {

  it('returns result when function succeeds on first attempt', async () => {
    const result = await withRetry(
      async () => 'success',
      { maxRetries: 3, delaysMs: [10, 10, 10], label: 'test', isTransient: () => true },
    );
    assert.equal(result, 'success');
  });

  it('retries and succeeds on transient error', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error('rate limit'), { status: 429 });
        return 'recovered';
      },
      { maxRetries: 3, delaysMs: [10, 10, 10], label: 'test', isTransient: (e: any) => e?.status === 429 },
    );
    assert.equal(result, 'recovered');
    assert.equal(attempts, 3);
  });

  it('throws immediately on non-transient error', async () => {
    let attempts = 0;
    await assert.rejects(
      withRetry(
        async () => {
          attempts++;
          throw new Error('fatal');
        },
        { maxRetries: 3, delaysMs: [10, 10, 10], label: 'test', isTransient: () => false },
      ),
      /fatal/,
    );
    assert.equal(attempts, 1, 'should not retry on non-transient error');
  });

  it('throws after exhausting retries on persistent transient errors', async () => {
    let attempts = 0;
    await assert.rejects(
      withRetry(
        async () => {
          attempts++;
          throw Object.assign(new Error('timeout'), { status: 503 });
        },
        { maxRetries: 2, delaysMs: [10, 10], label: 'test', isTransient: (e: any) => e?.status === 503 },
      ),
      /timeout/,
    );
    assert.equal(attempts, 3, 'should retry 3 times (initial + 2 retries)');
  });

  it('handles zero maxRetries (no retry)', async () => {
    await assert.rejects(
      withRetry(
        async () => { throw new Error('fail'); },
        { maxRetries: 0, delaysMs: [], label: 'test', isTransient: () => true },
      ),
      /fail/,
    );
  });

});
