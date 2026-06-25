import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Tier 1 — simplify skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/simplify.js');
    skill = mod.createSimplifySkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'simplify');
    assert.ok(skill.description);
    assert.ok(skill.whenToUse);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes Simplify header', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Simplify'));
  });

  it('getPrompt includes phases', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Phase 1'));
    assert.ok(prompt.includes('Phase 2'));
    assert.ok(prompt.includes('Phase 3'));
  });

  it('getPrompt appends args as additional focus', async () => {
    const prompt = await skill.getPrompt('check memory leaks', { cwd: '/test' });
    assert.ok(prompt.includes('memory leaks'));
  });

  it('getPrompt references run_agent tool', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('run_agent'));
  });

  it('getPrompt references run_bash_command', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('run_bash_command'));
  });
});

describe('Tier 1 — verify skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/verify.js');
    skill = mod.createVerifySkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'verify');
    assert.ok(skill.description);
    assert.ok(skill.whenToUse);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes Verify header', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Verify'));
  });

  it('getPrompt includes verification steps', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('变更'));
  });

  it('getPrompt appends user request', async () => {
    const prompt = await skill.getPrompt('test the login flow', { cwd: '/test' });
    assert.ok(prompt.includes('login flow'));
  });

  it('getPrompt references run_bash_command', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('run_bash_command'));
  });

  it('disableModelInvocation is false', () => {
    assert.equal(skill.disableModelInvocation, undefined);
  });
});

describe('Tier 1 — lorem-ipsum skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/lorem-ipsum.js');
    skill = mod.createLoremIpsumSkill();
  });

  it('has correct name and disableModelInvocation', () => {
    assert.equal(skill.name, 'lorem-ipsum');
    assert.equal(skill.disableModelInvocation, true);
  });

  it('getPrompt returns error for invalid args', async () => {
    const prompt = await skill.getPrompt('invalid', { cwd: '/test' });
    assert.ok(prompt.includes('无效'));
  });

  it('getPrompt returns error for negative args', async () => {
    const prompt = await skill.getPrompt('-5', { cwd: '/test' });
    assert.ok(prompt.includes('无效'));
  });

  it('getPrompt generates text for valid token count', async () => {
    const prompt = await skill.getPrompt('50', { cwd: '/test' });
    // Should include actual generated text
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 20);
  });

  it('getPrompt caps at 500000 tokens', async () => {
    const prompt = await skill.getPrompt('999999', { cwd: '/test' });
    assert.ok(prompt.includes('截断'));
  });

  it('getPrompt defaults to 10000 tokens when no args', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
  });

  it('has argumentHint', () => {
    assert.ok(skill.argumentHint);
    assert.ok(skill.argumentHint!.includes('token'));
  });
});
