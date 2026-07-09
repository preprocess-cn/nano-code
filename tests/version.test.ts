import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { getPackageVersion, getPackageName } from '../src/utils/version.js';

describe('version', () => {
  it('returns expected version string', () => {
    assert.equal(getPackageVersion(), '0.1.0');
  });

  it('returns expected package name', () => {
    assert.equal(getPackageName(), 'nano-code');
  });
});
