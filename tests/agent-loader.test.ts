import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadAgentDefinitions } from '../src/agent-loader.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nc-agent-loader-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
}

describe('loadAgentDefinitions', () => {

  it('returns empty array when directory does not exist', () => {
    const result = loadAgentDefinitions('/tmp/nonexistent-agent-dir-xyz');
    assert.deepEqual(result, []);
  });

  it('returns empty array when directory is empty', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const result = loadAgentDefinitions(dir);
      assert.deepEqual(result, []);
    } finally {
      rmDir(dir);
    }
  });

  it('loads a valid YAML agent definition', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'dba.yaml'), `
name: dba
description: 数据库专家
role: 你是一个 DBA
plugins:
  command:
    enabled: true
`, 'utf-8');

      const result = loadAgentDefinitions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'dba');
      assert.equal(result[0].description, '数据库专家');
      assert.equal(result[0].role, '你是一个 DBA');
      assert.ok(result[0].plugins);
    } finally {
      rmDir(dir);
    }
  });

  it('loads multiple agent definitions', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'dba.yaml'), 'name: dba\ndescription: DB expert\nrole: You are a DBA\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'reviewer.yaml'), 'name: reviewer\ndescription: Code reviewer\nrole: You review code\n', 'utf-8');

      const result = loadAgentDefinitions(dir);
      assert.equal(result.length, 2);
    } finally {
      rmDir(dir);
    }
  });

  it('skips files with missing required fields', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'good.yaml'), 'name: good\ndescription: Good one\nrole: Hello\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'no-name.yaml'), 'description: Missing name\nrole: Hello\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'no-desc.yaml'), 'name: no-desc\nrole: Hello\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'no-role.yaml'), 'name: no-role\ndescription: Missing role\n', 'utf-8');

      const result = loadAgentDefinitions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'good');
    } finally {
      rmDir(dir);
    }
  });

  it('skips invalid YAML files with warning', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'valid.yaml'), 'name: valid\ndescription: Valid\nrole: Ok\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'invalid.yaml'), '{invalid yaml: [}', 'utf-8');

      const result = loadAgentDefinitions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'valid');
    } finally {
      rmDir(dir);
    }
  });

  it('skips non-yaml files', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'agent.yaml'), 'name: agent\ndescription: A\nrole: R\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'readme.md'), '# not an agent', 'utf-8');
      fs.writeFileSync(path.join(dir, 'data.json'), '{}', 'utf-8');

      const result = loadAgentDefinitions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'agent');
    } finally {
      rmDir(dir);
    }
  });

});
