import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NanoCodeAgent } from '../src/core/agent.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { SK, type AgentModeInfo } from '../src/core/store-keys.js';
import {
  createAgentSlashPlugin,
  setTargetAgent,
  _resetState,
} from '../src/plugins/commands/agent-slash.js';

function mockLLM() {
  return {
    sendSystemMessage: async () => ({ text: 'mock', stopReason: 'stop' }),
    getModel: () => 'gpt-4o',
  } as any;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nc-agent-slash-test-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
}

function writeAgent(dir: string, name: string, props: Record<string, string> = {}): void {
  const lines = Object.entries({ name, description: 'description', role: 'role', ...props })
    .map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, `${name}.yaml`), lines.join('\n'), 'utf-8');
}

describe('agent-slash plugin', () => {

  afterEach(() => {
    _resetState();
  });

  it('non-slash input returns null', async () => {
    const plugin = createAgentSlashPlugin(undefined, '/tmp');
    const result = await plugin.onBeforeAgentInput!('hello');
    assert.strictEqual(result, null);
  });

  it('returns null when agent name does not match any definition', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const plugin = createAgentSlashPlugin(undefined, dir);
      const result = await plugin.onBeforeAgentInput!('/nonexistent');
      assert.strictEqual(result, null);
    } finally {
      rmDir(dir);
    }
  });

  it('switches to matching agent and updates mode', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const registry = new PluginRegistry();
      const agent = new NanoCodeAgent({ registry, llmClient: mockLLM() });
      setTargetAgent(agent);
      const plugin = createAgentSlashPlugin(undefined, dir);
      await plugin.onInit!(registry);

      const result = await plugin.onBeforeAgentInput!('/dba');
      assert.ok(result);
      assert.equal(result.handled, true);
      assert.equal(result.skipAgent, true);

      const mode = registry.store.get<AgentModeInfo>(SK.AgentMode);
      assert.ok(mode);
      assert.equal(mode!.name, 'dba');
      assert.equal(mode!.description, 'DB expert');
      assert.equal(agent.getAgentRole(), 'You are a DBA');
    } finally {
      rmDir(dir);
    }
  });

  it('/main resets to default mode', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const registry = new PluginRegistry();
      const agent = new NanoCodeAgent({ registry, llmClient: mockLLM() });
      setTargetAgent(agent);
      const plugin = createAgentSlashPlugin(undefined, dir);
      await plugin.onInit!(registry);

      await plugin.onBeforeAgentInput!('/dba');
      assert.ok(registry.store.get<AgentModeInfo>(SK.AgentMode));

      const result = await plugin.onBeforeAgentInput!('/main');
      assert.ok(result);
      assert.equal(result.handled, true);
      assert.equal(result.skipAgent, true);

      assert.strictEqual(registry.store.get<AgentModeInfo>(SK.AgentMode), undefined);
      assert.strictEqual(agent.getAgentRole(), undefined);
    } finally {
      rmDir(dir);
    }
  });

  it('/default also resets to default mode', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const registry = new PluginRegistry();
      const agent = new NanoCodeAgent({ registry, llmClient: mockLLM() });
      setTargetAgent(agent);
      const plugin = createAgentSlashPlugin(undefined, dir);
      await plugin.onInit!(registry);

      await plugin.onBeforeAgentInput!('/dba');
      assert.ok(registry.store.get<AgentModeInfo>(SK.AgentMode));

      const result = await plugin.onBeforeAgentInput!('/default');
      assert.ok(result);
      assert.strictEqual(registry.store.get<AgentModeInfo>(SK.AgentMode), undefined);
    } finally {
      rmDir(dir);
    }
  });

  it('returns null when no agent is set (agent ref is null)', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const plugin = createAgentSlashPlugin(undefined, dir);
      const result = await plugin.onBeforeAgentInput!('/dba');
      assert.strictEqual(result, null);
    } finally {
      rmDir(dir);
    }
  });

  it('applies systemPrompt from agent definition', async () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'expert.yaml'), [
        'name: expert',
        'description: Expert agent',
        'role: You are an expert',
        'systemPrompt:',
        '  withTools: "custom {tool_list}"',
        '  noTools: "custom no tools"',
        '  projectFiles:',
        '    - CLAUDE.md',
      ].join('\n'), 'utf-8');

      const registry = new PluginRegistry();
      const agent = new NanoCodeAgent({ registry, llmClient: mockLLM() });
      setTargetAgent(agent);
      const plugin = createAgentSlashPlugin(undefined, dir);
      await plugin.onInit!(registry);

      await plugin.onBeforeAgentInput!('/expert');
      assert.equal(agent.getAgentRole(), 'You are an expert');
      assert.equal(registry.store.get<AgentModeInfo>(SK.AgentMode)?.name, 'expert');
    } finally {
      rmDir(dir);
    }
  });

  it('handles agent name with trailing args', async () => {
    const dir = tmpDir();
    try {
      writeAgent(dir, 'dba', { description: 'DB expert', role: 'You are a DBA' });
      const agent = new NanoCodeAgent({ registry: new PluginRegistry(), llmClient: mockLLM() });
      setTargetAgent(agent);
      const plugin = createAgentSlashPlugin(undefined, dir);

      const result = await plugin.onBeforeAgentInput!('/dba some extra text');
      assert.ok(result);
      assert.equal(result!.handled, true);
      assert.equal(agent.getAgentRole(), 'You are a DBA');
    } finally {
      rmDir(dir);
    }
  });

});
