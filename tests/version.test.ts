import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { getPackageVersion, getPackageName } from '../src/utils/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

describe('version', () => {
  it('returns version matching package.json', () => {
    assert.equal(getPackageVersion(), pkg.version);
  });

  it('returns package name matching package.json', () => {
    assert.equal(getPackageName(), pkg.name);
  });
});
