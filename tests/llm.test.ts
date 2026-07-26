import { describe, it } from 'vitest';
import * as assert from 'node:assert/strict';
import { resolveEnvVar } from '../src/core/llm.js';

describe('resolveEnvVar', () => {
  it('returns literal string as-is when no $ prefix', () => {
    assert.equal(resolveEnvVar('sk-literal'), 'sk-literal');
  });

  it('returns literal string with leading char that looks like env', () => {
    assert.equal(resolveEnvVar('plain-text'), 'plain-text');
  });

  it('resolves $ENV_VAR from process.env', () => {
    process.env.TEST_LLM_RESOLVE = 'resolved-value';
    assert.equal(resolveEnvVar('$TEST_LLM_RESOLVE'), 'resolved-value');
    delete process.env.TEST_LLM_RESOLVE;
  });

  it('throws when $ENV_VAR is not set', () => {
    assert.throws(() => resolveEnvVar('$NONEXISTENT_VAR_XYZ'), {
      message: /Environment variable "NONEXISTENT_VAR_XYZ" is not set/,
    });
  });
});
