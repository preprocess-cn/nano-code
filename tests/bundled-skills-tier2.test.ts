import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Tier 2 — debug skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/debug.js');
    skill = mod.createDebugSkill();
  });

  it('has correct name and disableModelInvocation', () => {
    assert.equal(skill.name, 'debug');
    assert.equal(skill.disableModelInvocation, true);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 20);
  });

  it('getPrompt includes Debug header', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Debug'));
  });

  it('getPrompt includes user issue when provided', async () => {
    const prompt = await skill.getPrompt('server crash on startup', { cwd: '/test' });
    assert.ok(prompt.includes('server crash'));
  });

  it('getPrompt shows default message when no args', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('未描述'));
  });

  it('has argumentHint', () => {
    assert.ok(skill.argumentHint);
  });
});

describe('Tier 2 — batch skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/batch.js');
    skill = mod.createBatchSkill();
  });

  it('has correct name and disableModelInvocation', () => {
    assert.equal(skill.name, 'batch');
    assert.equal(skill.disableModelInvocation, true);
  });

  it('getPrompt returns error when no args', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('请提供'));
  });

  it('getPrompt includes instruction when args provided', async () => {
    const prompt = await skill.getPrompt('add tests to all modules', { cwd: '/test' });
    assert.ok(prompt.includes('add tests'));
    assert.ok(prompt.includes('Phase 1'));
    assert.ok(prompt.includes('Phase 2'));
    assert.ok(prompt.includes('Phase 3'));
  });

  it('getPrompt references run_agent', async () => {
    const prompt = await skill.getPrompt('do something', { cwd: '/test' });
    assert.ok(prompt.includes('run_agent'));
  });
});

describe('Tier 2 — update-config skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/update-config.js');
    skill = mod.createUpdateConfigSkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'update-config');
    assert.ok(skill.description);
    assert.ok(skill.whenToUse);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes config file paths', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('.nano-code.yaml'));
    assert.ok(prompt.includes('config.yaml'));
  });

  it('getPrompt includes patch_file reference', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('patch_file'));
  });

  it('getPrompt includes restart notification requirement', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('重启'));
  });

  it('getPrompt appends user request', async () => {
    const prompt = await skill.getPrompt('add new model', { cwd: '/test' });
    assert.ok(prompt.includes('add new model'));
  });
});

describe('Tier 2 — remember skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/remember.js');
    skill = mod.createRememberSkill();
  });

  it('has correct name and whenToUse', () => {
    assert.equal(skill.name, 'remember');
    assert.ok(skill.whenToUse);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 50);
  });

  it('getPrompt references recall_memory', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('recall_memory'));
  });

  it('getPrompt includes memory review steps', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('记忆'));
    assert.ok(prompt.includes('重复'));
    assert.ok(prompt.includes('过期'));
  });

  it('getPrompt includes user consent rule', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('用户批准') || prompt.includes('同意'));
  });
});

describe('Tier 2 — stuck skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/stuck.js');
    skill = mod.createStuckSkill();
  });

  it('has correct name and disableModelInvocation', () => {
    assert.equal(skill.name, 'stuck');
    assert.equal(skill.disableModelInvocation, true);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes diagnosis steps', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('诊断'));
    assert.ok(prompt.includes('进程'));
    assert.ok(prompt.includes('报告'));
  });

  it('getPrompt does not include Claude Code specific references', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(!prompt.includes('Slack'));
    assert.ok(!prompt.includes('#claude'));
  });
});
