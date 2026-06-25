import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

describe('Tier 3 — skillify skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/skillify.js');
    skill = mod.createSkillifySkill();
  });

  it('has correct name and disableModelInvocation', () => {
    assert.equal(skill.name, 'skillify');
    assert.equal(skill.disableModelInvocation, true);
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes Skillify header', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Skillify'));
  });

  it('getPrompt includes SKILL.md format', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('SKILL.md'));
  });

  it('getPrompt includes skill directory path', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('.nano-code/skills'));
  });

  it('getPrompt appends args', async () => {
    const prompt = await skill.getPrompt('code review helper', { cwd: '/test' });
    assert.ok(prompt.includes('code review'));
  });

  it('has argumentHint', () => {
    assert.ok(skill.argumentHint);
  });
});

describe('Tier 3 — keybindings skill', () => {
  let skill: import('../src/plugins/skills/bundled/index.js').BundledSkillDef;

  beforeEach(async () => {
    const mod = await import('../src/plugins/skills/bundled/keybindings.js');
    skill = mod.createKeybindingsSkill();
  });

  it('has correct name and userInvocable false', () => {
    assert.equal(skill.name, 'keybindings');
    assert.equal(skill.userInvocable, false);
  });

  it('has whenToUse', () => {
    assert.ok(skill.whenToUse);
    assert.ok(skill.whenToUse!.includes('keybindings'));
  });

  it('getPrompt returns non-empty string', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.length > 50);
  });

  it('getPrompt includes terminal shortcuts', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    assert.ok(prompt.includes('Ctrl+'));
    assert.ok(prompt.includes('快捷键'));
  });

  it('getPrompt does not contain complex binding configuration', async () => {
    const prompt = await skill.getPrompt('', { cwd: '/test' });
    // nano-code doesn't have a keybinding system, so no JSON binding config
    assert.ok(!prompt.includes('"keys"'));
  });
});
