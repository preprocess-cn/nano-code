import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createSkillsPlugin } from '../src/plugins/skills/index.js';

let tmpDir: string;
let origEnv: string | undefined;

beforeEach(() => {
  origEnv = process.env['NANO_CODE_SKILLS_DIR'];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-skills-test-'));
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

function createSkillDir(name: string, context: string, description: string, body: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const content = `---
name: ${name}
description: ${description}
context: ${context}
---

${body}`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
  return dir;
}

describe('Skills Plugin', () => {

  describe('skills_list', () => {
    it('returns empty list when no skills directory exists', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skills_list', {}, {} as any);
      assert.equal(result.status, 'success');
      const data = JSON.parse(result.data!);
      assert.deepEqual(data.skills, []);
    });

    it('lists loaded skills', async () => {
      createSkillDir('review-pr', 'inline', 'Review a PR', 'Review the code...');
      createSkillDir('research', 'fork', 'Deep research', 'Research topic...');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skills_list', {}, {} as any);
      assert.equal(result.status, 'success');
      const data = JSON.parse(result.data!);
      assert.equal(data.skills.length, 2);
      // 按字母序: research < review-pr
      assert.equal(data.skills[0].name, 'research');
      assert.equal(data.skills[0].context, 'fork');
      assert.equal(data.skills[1].name, 'review-pr');
      assert.equal(data.skills[1].description, 'Review a PR');
      assert.equal(data.skills[1].context, 'inline');
    });
  });

  describe('skill_view', () => {
    it('returns full skill content', async () => {
      createSkillDir('test-skill', 'inline', 'Test skill', '## Instructions\n\nDo the thing with {args}.');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill_view', { name: 'test-skill' }, {} as any);
      assert.equal(result.status, 'success');
      const data = JSON.parse(result.data!);
      assert.equal(data.name, 'test-skill');
      assert.equal(data.context, 'inline');
      assert.equal(data.content, '## Instructions\n\nDo the thing with {args}.');
    });

    it('returns error for non-existent skill', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill_view', { name: 'nonexistent' }, {} as any);
      assert.equal(result.status, 'error');
      assert.ok(result.message?.includes('未找到'));
    });

    it('returns error for empty name', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill_view', { name: '' }, {} as any);
      assert.equal(result.status, 'error');
    });

    it('reads linked files in skill directory', async () => {
      const dir = createSkillDir('with-files', 'inline', 'Has files', 'Main content');
      fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'references', 'api.md'), '# API Reference');
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo hello');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill_view', { name: 'with-files' }, {} as any);
      assert.equal(result.status, 'success');
      const data = JSON.parse(result.data!);
      assert.ok(data.linkedFiles, 'should list linked files');
      assert.ok(data.linkedFiles.includes('references/api.md'));
      assert.ok(data.linkedFiles.includes('scripts/run.sh'));
    });

    it('reads a specific file from skill directory', async () => {
      const dir = createSkillDir('with-files', 'inline', 'Has files', 'Main content');
      fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'references', 'api.md'), '# API Reference');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill_view', { name: 'with-files', file_path: 'references/api.md' }, {} as any);
      assert.equal(result.status, 'success');
      const data = JSON.parse(result.data!);
      assert.equal(data.file, 'references/api.md');
      assert.equal(data.content, '# API Reference');
    });
  });

  describe('skill — inline mode', () => {
    it('returns newMessages for inline skill', async () => {
      createSkillDir('hello', 'inline', 'Say hello', '## Hello Skill\n\nRun hello world.');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill', { skill: 'hello' }, {} as any);
      assert.equal(result.status, 'success');
      assert.ok(result.newMessages, 'inline skill should return newMessages');
      assert.equal(result.newMessages!.length, 1);
      assert.equal(result.newMessages![0].role, 'user');
      assert.ok(result.newMessages![0].content.includes('Hello Skill'));
    });

    it('substitutes {args} in inline skill content', async () => {
      createSkillDir('greet', 'inline', 'Greet', '## Greet\n\nUser said: {args}');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill', { skill: 'greet', args: 'hello world' }, {} as any);
      assert.equal(result.status, 'success');
      assert.ok(result.newMessages);
      assert.ok(result.newMessages![0].content.includes('User said: hello world'));
    });

    it('returns error for non-existent skill', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill', { skill: 'nope' }, {} as any);
      assert.equal(result.status, 'error');
    });

    it('returns error for empty skill name', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill', { skill: '' }, {} as any);
      assert.equal(result.status, 'error');
    });
  });

  describe('skill — fork mode (without LLMClient)', () => {
    it('falls back to inline when no LLMClient provided', async () => {
      createSkillDir('deep-dive', 'fork', 'Deep dive', '## Deep Dive\n\nResearch {args} thoroughly.');

      const plugin = createSkillsPlugin();
      const result = await plugin.execute('skill', { skill: 'deep-dive', args: 'AI safety' }, {} as any);
      assert.equal(result.status, 'success');
      // Should fallback to inline (newMessages) since no llmClient
      assert.ok(result.newMessages, 'should fallback to inline newMessages');
      assert.ok(result.newMessages![0].content.includes('AI safety'));
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const plugin = createSkillsPlugin();
      const result = await plugin.execute('nonexistent_tool', {}, {} as any);
      assert.equal(result.status, 'error');
    });
  });

});
