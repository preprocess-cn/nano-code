import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Tier 1 — review skill (simple PR review)', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/review.js');
    skill = mod.createReviewSkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'review');
    assert.ok(skill.description);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 50);
  });

  it('getPrompt references gh pr commands', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('gh pr list'));
    assert.ok(prompt.includes('gh pr view'));
    assert.ok(prompt.includes('gh pr diff'));
  });

  it('getPrompt includes --json fields for pr view', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('--json'));
    assert.ok(prompt.includes('baseRefName'));
    assert.ok(prompt.includes('headRefName'));
  });

  it('getPrompt includes PR number when args is a number', async () => {
    const prompt = await skill.getPrompt('42', { cwd: '/test' });
    assert.ok(prompt.includes('PR number: 42'));
  });

  it('getPrompt shows focus areas', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Code correctness'));
    assert.ok(prompt.includes('Performance implications'));
    assert.ok(prompt.includes('Security considerations'));
  });
});

describe('Tier 1 — code-review skill (7-angle deep review)', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/code-review.js');
    skill = mod.createCodeReviewSkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'code-review');
    assert.ok(skill.description);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 100);
  });

  it('getPrompt includes phases', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Phase 0'));
    assert.ok(prompt.includes('Phase 1'));
    assert.ok(prompt.includes('Phase 2'));
  });

  it('getPrompt references agent-general-purpose and run_bash_command', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('agent-general-purpose'));
    assert.ok(prompt.includes('run_bash_command'));
  });

  it('getPrompt mentions all seven finder angles', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('line-by-line diff scan'));
    assert.ok(prompt.includes('removed-behavior auditor'));
    assert.ok(prompt.includes('cross-file tracer'));
    assert.ok(prompt.includes('Reuse'));
    assert.ok(prompt.includes('Simplification'));
    assert.ok(prompt.includes('Efficiency'));
    assert.ok(prompt.includes('Altitude'));
  });

  it('getPrompt includes verify phase with CONFIRMED/PLAUSIBLE/REFUTED', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('CONFIRMED'));
    assert.ok(prompt.includes('PLAUSIBLE'));
    assert.ok(prompt.includes('REFUTED'));
  });

  it('getPrompt specifies JSON array output format', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('JSON array'));
    assert.ok(prompt.includes('"file"'));
    assert.ok(prompt.includes('"line"'));
    assert.ok(prompt.includes('"failure_scenario"'));
  });

  it('getPrompt includes candidate cap of 6 per angle and 10 total', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('up to 6'));
    assert.ok(prompt.includes('at most 10'));
  });

  it('getPrompt does NOT include --fix section', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(!prompt.includes('Applying fixes (--fix)'));
  });
});

describe('Tier 1 — simplify skill (wrapper: code-review + --fix)', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/simplify.js');
    skill = mod.createSimplifySkill();
  });

  it('has correct name and description', () => {
    assert.equal(skill.name, 'simplify');
    assert.ok(skill.description);
  });

  it('getPrompt includes Simplify title', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Simplify'));
  });

  it('getPrompt includes --fix section', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Applying fixes (--fix)'));
  });

  it('getPrompt delegates to code-review content', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('7 independent finder angles'));
    assert.ok(prompt.includes('CONFIRMED'));
    assert.ok(prompt.includes('JSON array'));
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
