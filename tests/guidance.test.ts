import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createGuidancePlugin, clearAgentCache } from '../src/plugins/guidance/index.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { ChatMessage } from '../src/core/llm.js';

// ── Helpers ──

function makeMsg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

function makeSystemMsg(content: string): ChatMessage {
  return makeMsg('system', content);
}

// ── Section content tests ──

describe('guidance plugin — buildGuidanceSections', () => {
  it('contains all 6 section headers with default config', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('hello');
    assert.ok(result.startsWith('# System\n'));
    assert.ok(result.includes('\n# Doing tasks\n'));
    assert.ok(result.includes('\n# Executing actions with care\n'));
    assert.ok(result.includes('\n# Using your tools\n'));
    assert.ok(result.includes('\n# Tone and style\n'));
    assert.ok(result.includes('\n# Output efficiency\n'));
    assert.ok(result.endsWith('\n\nhello'));
  });

  it('mentions key behavioral constraints in Doing tasks section', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes("Don't add features"));
    assert.ok(result.includes("Don't add error handling"));
    assert.ok(result.includes("Don't create helpers"));
    assert.ok(result.includes('Do not create files unless'));
    assert.ok(result.includes('code you haven\'t read'));
    assert.ok(result.includes('OWASP top 10'));
  });

  it('mentions tool usage guidance', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('Do NOT use the Bash tool'));
    assert.ok(result.includes('Read tool instead of cat'));
    assert.ok(result.includes('Edit tool instead of sed'));
    assert.ok(result.includes('Write tool instead of cat'));
  });

  it('mentions tone guidelines', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('Only use emojis if the user explicitly requests it'));
    assert.ok(result.includes('file_path:line_number'));
    assert.ok(result.includes('Do not use a colon before tool calls'));
  });

  it('mentions output efficiency', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('Go straight to the point'));
    assert.ok(result.includes('Lead with the answer'));
    assert.ok(result.includes('one sentence'));
  });

  it('respects sections filter — only includes requested sections', () => {
    const plugin = createGuidancePlugin({ sections: ['tone'] });
    const result = plugin.onSystemPrompt!('base');
    assert.ok(result.includes('# Tone and style'));
    assert.ok(!result.includes('# System'));
    assert.ok(!result.includes('# Doing tasks'));
    assert.ok(!result.includes('# Executing actions with care'));
    assert.ok(!result.includes('# Using your tools'));
    assert.ok(!result.includes('# Output efficiency'));
    assert.ok(result.endsWith('\n\nbase'));
  });

  it('respects sections filter — multiple sections', () => {
    const plugin = createGuidancePlugin({ sections: ['system', 'tone'] });
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('# System'));
    assert.ok(result.includes('# Tone and style'));
    assert.ok(!result.includes('# Doing tasks'));
  });

  it('respects sections filter — all sentinel expands to all sections', () => {
    const plugin = createGuidancePlugin({ sections: ['all'] });
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('# System'));
    assert.ok(result.includes('# Doing tasks'));
    assert.ok(result.includes('# Executing actions with care'));
    assert.ok(result.includes('# Using your tools'));
    assert.ok(result.includes('# Tone and style'));
    assert.ok(result.includes('# Output efficiency'));
  });

  it('respects sections filter — exclusion with -prefix removes section', () => {
    const plugin = createGuidancePlugin({ sections: ['all', '-tone'] });
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('# System'));
    assert.ok(!result.includes('# Tone and style'));
  });

  it('respects sections filter — bare exclusion treated as all minus', () => {
    const plugin = createGuidancePlugin({ sections: ['-output-efficiency'] });
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.includes('# System'));
    assert.ok(result.includes('# Doing tasks'));
    assert.ok(!result.includes('# Output efficiency'));
  });

  it('respects empty sections config (omits all)', () => {
    const plugin = createGuidancePlugin({ sections: [] });
    const result = plugin.onSystemPrompt!('hello');
    assert.equal(result, 'hello');
  });

  it('passes through empty prompt', () => {
    const plugin = createGuidancePlugin();
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.startsWith('# System'));
    assert.ok(result.trim().length > 50);
  });
});

// ── onBeforeRequest tests ──

describe('guidance plugin — onBeforeRequest', () => {
  let tempDir: string;
  let origCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-guidance-test-'));
    origCwd = process.cwd();
  });

  afterEach(() => {
    clearAgentCache();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('injects AGENT.md as user context at position 1', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENT.md'), 'Use tabs for indentation.', 'utf-8');

    const plugin = createGuidancePlugin();
    const sysMsg = makeSystemMsg('you are a bot');
    const userMsg = makeMsg('user', 'hello');
    const messages = [sysMsg, userMsg];

    process.chdir(tempDir);
    try {
      const result = plugin.onBeforeRequest!(messages);

      assert.equal(result.length, 3);
      assert.equal(result[0], sysMsg);
      assert.equal(result[0].role, 'system');
      assert.equal(result[1].role, 'user');
      assert.ok(result[1].content!.includes('AGENT.md'));
      assert.ok(result[1].content!.includes('Use tabs for indentation'));
      assert.ok(result[1].content!.includes('<system-reminder>'));
      assert.equal(result[2], userMsg);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('injects AGENT.local.md with higher priority than AGENT.md', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENT.md'), 'Use tabs.', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'AGENT.local.md'), 'Use spaces.', 'utf-8');

    const plugin = createGuidancePlugin();
    const messages = [makeSystemMsg('test'), makeMsg('user', 'hi')];

    process.chdir(tempDir);
    try {
      const result = plugin.onBeforeRequest!(messages);
      assert.ok(result[1].content!.includes('Use spaces.'));
      assert.ok(result[1].content!.includes('Use tabs.'));
      assert.ok(result[1].content!.includes('AGENT.local.md'));
      assert.ok(result[1].content!.includes('AGENT.md'));
    } finally {
      process.chdir(origCwd);
    }
  });

  it('returns messages unchanged when no AGENT.md exists', () => {
    const plugin = createGuidancePlugin();
    const messages = [makeSystemMsg('you are a bot'), makeMsg('user', 'hello')];

    process.chdir(tempDir);
    try {
      const result = plugin.onBeforeRequest!(messages);
      assert.equal(result.length, 2);
      assert.equal(result[0], messages[0]);
      assert.equal(result[1], messages[1]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('returns messages unchanged when injectAgentMd is false', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENT.md'), 'Some guidelines.', 'utf-8');
    const plugin = createGuidancePlugin({ injectAgentMd: false });
    const messages = [makeSystemMsg('bot'), makeMsg('user', 'hello')];

    process.chdir(tempDir);
    try {
      const result = plugin.onBeforeRequest!(messages);
      assert.equal(result.length, 2);
      assert.equal(result[0], messages[0]);
      assert.equal(result[1], messages[1]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('clears cache between test runs via clearAgentCache', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENT.md'), 'v1 content', 'utf-8');
    const plugin = createGuidancePlugin();
    const messages = [makeSystemMsg('test'), makeMsg('user', 'hi')];

    process.chdir(tempDir);
    try {
      const r1 = plugin.onBeforeRequest!(messages);
      assert.ok(r1[1].content!.includes('v1 content'));

      fs.writeFileSync(path.join(tempDir, 'AGENT.md'), 'v2 content', 'utf-8');
      clearAgentCache();

      const r2 = plugin.onBeforeRequest!(messages);
      assert.ok(r2[1].content!.includes('v2 content'));
    } finally {
      process.chdir(origCwd);
    }
  });

  it('reads user global ~/.nano-code/AGENT.md', () => {
    const homeDir = path.join(tempDir, 'home');
    const nanoCodeDir = path.join(homeDir, '.nano-code');
    fs.mkdirSync(nanoCodeDir, { recursive: true });
    fs.writeFileSync(path.join(nanoCodeDir, 'AGENT.md'), 'Global preference: be concise.', 'utf-8');

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    const plugin = createGuidancePlugin();
    const messages = [makeSystemMsg('test'), makeMsg('user', 'hi')];

    process.chdir(tempDir);
    try {
      const result = plugin.onBeforeRequest!(messages);
      assert.equal(result.length, 3);
      assert.ok(result[1].content!.includes('Global preference'));
      assert.ok(result[1].content!.includes('~/.nano-code/AGENT.md'));
    } finally {
      process.chdir(origCwd);
      process.env.HOME = origHome;
    }
  });

  it('recaches when cwd changes', () => {
    // Create two directories with different AGENT.md
    const dirA = path.join(tempDir, 'project-a');
    const dirB = path.join(tempDir, 'project-b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'AGENT.md'), 'Project A rules', 'utf-8');
    fs.writeFileSync(path.join(dirB, 'AGENT.md'), 'Project B rules', 'utf-8');

    const plugin = createGuidancePlugin();
    const messages = [makeSystemMsg('test'), makeMsg('user', 'hi')];

    process.chdir(dirA);
    try {
      const r1 = plugin.onBeforeRequest!(messages);
      assert.ok(r1[1].content!.includes('Project A rules'));

      process.chdir(dirB);
      // Cache should be invalidated by cwd change
      const r2 = plugin.onBeforeRequest!(messages);
      assert.ok(r2[1].content!.includes('Project B rules'));
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ── Plugin structure tests ──

describe('guidance plugin — structure', () => {
  it('returns valid NanoPlugin with correct name', () => {
    const plugin = createGuidancePlugin();
    assert.equal(plugin.name, 'guidance');
    assert.equal(plugin.description, 'System prompt behavioral guidance sections and AGENT.md context injection');
  });

  it('provides no tools', () => {
    const plugin = createGuidancePlugin();
    const tools = plugin.getTools();
    assert.deepEqual(tools, []);
  });

  it('execute returns error (no tools provided)', async () => {
    const plugin = createGuidancePlugin();
    const result = await plugin.execute('any_tool', {}, { skipPermission: true, cwd: '', defaultTimeout: 0, sideEffect: false });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('does not provide tools'));
  });

  it('registers in PluginRegistry', async () => {
    const registry = new PluginRegistry();
    const plugin = createGuidancePlugin();
    await registry.register(plugin);

    const schemas = registry.getAllSchemas();
    const guidanceTool = schemas.find(s => s.function.name === 'guidance');
    assert.equal(guidanceTool, undefined);
  });

  it('config merges with defaults', () => {
    const plugin = createGuidancePlugin({ injectAgentMd: false });
    assert.equal(plugin.name, 'guidance');
    const result = plugin.onSystemPrompt!('');
    assert.ok(result.startsWith('# System'));
  });
});
