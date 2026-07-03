import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Bundled skills registry tests ──

describe('Bundled Skills Registry', () => {
  let registry: typeof import('../src/plugins/skills/bundled/index.js');

  beforeEach(async () => {
    // Clear module state by re-importing
    registry = await import('../src/plugins/skills/bundled/index.js');
    registry.clearBundledSkills();
  });

  it('register and find a skill', () => {
    const skill = {
      name: 'test-skill',
      description: 'Test skill',
      getPrompt: async () => 'test prompt',
    };
    registry.registerBundledSkill(skill);
    assert.equal(registry.findBundledSkill('test-skill'), skill);
  });

  it('unregister removes a skill', () => {
    registry.registerBundledSkill({
      name: 'to-remove',
      description: 'Will be removed',
      getPrompt: async () => '',
    });
    assert.ok(registry.unregisterBundledSkill('to-remove'));
    assert.equal(registry.findBundledSkill('to-remove'), undefined);
  });

  it('getBundledSkills returns all registered skills', () => {
    registry.registerBundledSkill({
      name: 'a', description: 'A', getPrompt: async () => '',
    });
    registry.registerBundledSkill({
      name: 'b', description: 'B', getPrompt: async () => '',
    });
    assert.equal(registry.getBundledSkills().length, 2);
  });

  it('clearBundledSkills empties the registry', () => {
    registry.registerBundledSkill({
      name: 'x', description: 'X', getPrompt: async () => '',
    });
    registry.clearBundledSkills();
    assert.equal(registry.getBundledSkills().length, 0);
  });

  it('getSystemPromptSkills excludes disableModelInvocation', () => {
    registry.clearBundledSkills();
    registry.registerBundledSkill({
      name: 'visible',
      description: 'Visible',
      getPrompt: async () => '',
    });
    registry.registerBundledSkill({
      name: 'hidden',
      description: 'Hidden',
      disableModelInvocation: true,
      getPrompt: async () => '',
    });
    const skills = registry.getSystemPromptSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'visible');
  });

  it('formatSkillDescription includes whenToUse', () => {
    const skill = {
      name: 'test',
      description: 'Do things',
      whenToUse: 'when user says do',
      getPrompt: async () => '',
    };
    const formatted = registry.formatSkillDescription(skill);
    assert.ok(formatted.includes('Do things'));
    assert.ok(formatted.includes('when user says do'));
  });

  it('formatSkillDescription skips whenToUse if absent', () => {
    const skill = {
      name: 'test',
      description: 'Do things',
      getPrompt: async () => '',
    };
    const formatted = registry.formatSkillDescription(skill);
    assert.ok(formatted.includes('Do things'));
    assert.ok(!formatted.includes('undefined'));
  });

  it('buildSkillsPromptSection returns empty string when no visible skills', () => {
    registry.clearBundledSkills();
    assert.equal(registry.buildSkillsPromptSection(), '');
  });

  it('buildSkillsPromptSection returns content for visible skills', () => {
    registry.clearBundledSkills();
    registry.registerBundledSkill({
      name: 'my-skill',
      description: 'My skill',
      whenToUse: 'use it',
      getPrompt: async () => '',
    });
    const section = registry.buildSkillsPromptSection();
    assert.ok(section.includes('my-skill'));
    assert.ok(section.includes('My skill'));
    assert.ok(section.includes('use it'));
  });

  it('registerAllDefaultBundledSkills registers all 11 skills', () => {
    registry.clearBundledSkills();
    registry.registerAllDefaultBundledSkills();
    const all = registry.getBundledSkills();
    assert.equal(all.length, 11);
    const names = all.map(s => s.name).sort();
    assert.deepEqual(names, [
      'batch', 'debug', 'keybindings', 'lorem-ipsum',
      'remember', 'review', 'simplify', 'skillify', 'stuck',
      'update-config', 'verify',
    ]);
  });
});

// ── Skills plugin with bundle integration ──

describe('Skills Plugin with Bundled Skills', () => {
  let skillsPlugin: any;
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(async () => {
    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    // Create skills plugin without disabled skills
    const { createSkillsPlugin } = await import('../src/plugins/skills/index.js');
    skillsPlugin = createSkillsPlugin(undefined, undefined, {
      disabled: [],
      disableSkillTool: false,
    });

    // Set up temp dir for filesystem skills
    origEnv = process.env['NANO_CODE_SKILLS_DIR'];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-bundled-test-'));
    process.env['NANO_CODE_SKILLS_DIR'] = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env['NANO_CODE_SKILLS_DIR'];
    } else {
      process.env['NANO_CODE_SKILLS_DIR'] = origEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skills_list includes bundled skills', async () => {
    const result = await skillsPlugin.execute('skills_list', {}, {} as any);
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    // Should include bundled skills that are not disableModelInvocation
    const bundledNames = data.skills.map((s: any) => s.name);
    assert.ok(bundledNames.includes('simplify'));
    assert.ok(bundledNames.includes('verify'));
    assert.ok(bundledNames.includes('update-config'));
    assert.ok(bundledNames.includes('remember'));
    assert.ok(bundledNames.includes('keybindings'));
    // disableModelInvocation skills should NOT be listed
    assert.ok(!bundledNames.includes('debug'));
    assert.ok(!bundledNames.includes('batch'));
    assert.ok(!bundledNames.includes('lorem-ipsum'));
    assert.ok(!bundledNames.includes('stuck'));
    assert.ok(!bundledNames.includes('skillify'));
  });

  it('skills_list excludes disabled skills', async () => {
    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    const { createSkillsPlugin: createPlugin } = await import('../src/plugins/skills/index.js');
    const plugin = createPlugin(undefined, undefined, {
      disabled: ['simplify', 'verify'],
      disableSkillTool: false,
    });
    const result = await plugin.execute('skills_list', {}, {} as any);
    const data = JSON.parse(result.data!);
    const names = data.skills.map((s: any) => s.name);
    assert.ok(!names.includes('simplify'));
    assert.ok(!names.includes('verify'));
  });

  it('skill_view shows bundled skill info', async () => {
    const result = await skillsPlugin.execute('skill_view', { name: 'simplify' }, {} as any);
    assert.equal(result.status, 'success');
    const data = JSON.parse(result.data!);
    assert.equal(data.name, 'simplify');
    assert.equal(data.type, 'bundled');
    assert.ok(data.description);
  });

  it('skill_view returns error for disabled skill', async () => {
    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    const { createSkillsPlugin: createPlugin } = await import('../src/plugins/skills/index.js');
    const plugin = createPlugin(undefined, undefined, {
      disabled: ['simplify'],
      disableSkillTool: false,
    });
    const result = await plugin.execute('skill_view', { name: 'simplify' }, {} as any);
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('禁用'));
  });

  it('skill returns newMessages for bundled skill', async () => {
    const result = await skillsPlugin.execute('skill', { skill: 'simplify' }, {} as any);
    assert.equal(result.status, 'success');
    assert.ok(result.message?.includes('内置'));
    assert.ok(result.newMessages);
    assert.equal(result.newMessages!.length, 1);
    assert.equal(result.newMessages![0].role, 'user');
    assert.ok(result.newMessages![0].content.includes('Simplify'));
  });

  it('skill returns error for disabled bundled skill', async () => {
    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    const { createSkillsPlugin: createPlugin } = await import('../src/plugins/skills/index.js');
    const plugin = createPlugin(undefined, undefined, {
      disabled: ['simplify'],
      disableSkillTool: false,
    });
    const result = await plugin.execute('skill', { skill: 'simplify' }, {} as any);
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('禁用'));
  });

  it('skills_list excludes filesystem skills that match disabled names', async () => {
    // Create a filesystem skill named 'simplify'
    const dir = path.join(tmpDir, 'simplify');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---
name: simplify
description: Filesystem simplify
context: inline
---
FS version`, 'utf-8');

    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    const { createSkillsPlugin: createPlugin } = await import('../src/plugins/skills/index.js');
    const plugin = createPlugin(undefined, undefined, {
      disabled: ['simplify'],
      disableSkillTool: false,
    });
    const result = await plugin.execute('skills_list', {}, {} as any);
    const data = JSON.parse(result.data!);
    const names = data.skills.map((s: any) => s.name);
    assert.ok(!names.includes('simplify'));
  });

  it('skill tool is not registered when disableSkillTool is true', async () => {
    const bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
    bundled.registerAllDefaultBundledSkills();

    const { createSkillsPlugin: createPlugin } = await import('../src/plugins/skills/index.js');
    const plugin = createPlugin(undefined, undefined, {
      disableSkillTool: true,
    });
    const tools = plugin.getTools();
    const toolNames = tools.map((t: any) => t.function.name);
    assert.ok(!toolNames.includes('skill'));
    assert.ok(!toolNames.includes('skills_list'));
    assert.ok(!toolNames.includes('skill_view'));
    // run_agent should still be available
    assert.ok(toolNames.includes('run_agent'));
  });

  it('run_agent returns error when no LLMClient', async () => {
    const result = await skillsPlugin.execute('run_agent', { query: 'test' }, {} as any);
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('无 LLM 客户端'));
  });

  it('run_agent returns error for empty query', async () => {
    const result = await skillsPlugin.execute('run_agent', { query: '' }, {} as any);
    assert.equal(result.status, 'error');
  });

  it('onSystemPrompt adds skills section', () => {
    const result = skillsPlugin.onSystemPrompt?.('base prompt');
    assert.ok(result);
    assert.ok(result.startsWith('base prompt'));
    assert.ok(result.includes('simplify'));
    // disableModelInvocation skills not in prompt
    assert.ok(!result.includes('lorem-ipsum'));
  });

  it('getTools returns all tools by default', () => {
    const tools = skillsPlugin.getTools();
    const toolNames = tools.map((t: any) => t.function.name);
    assert.ok(toolNames.includes('skills_list'));
    assert.ok(toolNames.includes('skill_view'));
    assert.ok(toolNames.includes('skill'));
    assert.ok(toolNames.includes('run_agent'));
  });
});

// ── buildSystemPrompt integration (via plugin onSystemPrompt) ──

describe('buildSystemPrompt with skill listing', () => {
  let bundled: typeof import('../src/plugins/skills/bundled/index.js');

  beforeEach(async () => {
    bundled = await import('../src/plugins/skills/bundled/index.js');
    bundled.clearBundledSkills();
  });

  it('injects skill listing into system prompt', async () => {
    bundled.registerBundledSkill({
      name: 'my-tool',
      description: 'My tool',
      whenToUse: 'use when needed',
      getPrompt: async () => '',
    });

    const { buildSystemPrompt } = await import('../src/core/prompt.js');
    const { PluginRegistry } = await import('../src/core/plugin.js');
    const { createSkillsPlugin } = await import('../src/plugins/skills/index.js');
    const registry = new PluginRegistry();
    await registry.register(createSkillsPlugin());

    const result = buildSystemPrompt(registry, undefined);
    assert.ok(result.content);
    assert.ok(result.content!.includes('my-tool'));
    assert.ok(result.content!.includes('My tool'));
    assert.ok(result.content!.includes('use when needed'));
  });

  it('does not inject disableModelInvocation skills', async () => {
    bundled.registerBundledSkill({
      name: 'hidden-skill',
      description: 'Hidden',
      disableModelInvocation: true,
      getPrompt: async () => '',
    });
    // Register a visible skill so the prompt section is non-empty
    bundled.registerBundledSkill({
      name: 'visible-skill',
      description: 'Visible',
      getPrompt: async () => '',
    });

    const { buildSystemPrompt } = await import('../src/core/prompt.js');
    const { PluginRegistry } = await import('../src/core/plugin.js');
    const { createSkillsPlugin } = await import('../src/plugins/skills/index.js');
    const registry = new PluginRegistry();
    await registry.register(createSkillsPlugin());

    const result = buildSystemPrompt(registry, undefined);
    assert.ok(result.content);
    assert.ok(result.content!.includes('visible-skill'));
    assert.ok(!result.content!.includes('hidden-skill'));
  });

  it('does not duplicate skill listing when plugin is registered', async () => {
    bundled.registerBundledSkill({
      name: 'alpha',
      description: 'Alpha tool',
      getPrompt: async () => '',
    });
    bundled.registerBundledSkill({
      name: 'beta',
      description: 'Beta tool',
      getPrompt: async () => '',
    });

    const { buildSystemPrompt } = await import('../src/core/prompt.js');
    const { PluginRegistry } = await import('../src/core/plugin.js');
    const { createSkillsPlugin } = await import('../src/plugins/skills/index.js');
    const registry = new PluginRegistry();
    await registry.register(createSkillsPlugin());

    const result = buildSystemPrompt(registry, undefined);
    assert.ok(result.content);

    // Each skill name should appear exactly once (no duplicate injection)
    const alphaMatches = result.content!.match(/alpha/g);
    const betaMatches = result.content!.match(/beta/g);
    assert.strictEqual(alphaMatches?.length ?? 0, 1);
    assert.strictEqual(betaMatches?.length ?? 0, 1);
  });

  it('returns base prompt when no skills registered', async () => {
    const { buildSystemPrompt } = await import('../src/core/prompt.js');
    const { PluginRegistry } = await import('../src/core/plugin.js');
    const registry = new PluginRegistry();

    const result = buildSystemPrompt(registry, {
      noTools: 'You are a helpful assistant.',
    });
    assert.ok(result.content);
    assert.ok(result.content!.includes('helpful assistant'));
  });
});
