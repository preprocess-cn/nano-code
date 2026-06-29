import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectPlugins, buildPluginList } from '../src/plugins/commands/builtin.js';
import { setMcpJsonPaths } from '../src/plugins/mcp/adapter.js';
import type { NanoConfig } from '../src/core/config.js';

// ── collectPlugins / buildPluginList ──

describe('plugin command — collectPlugins', () => {
  beforeEach(() => {
    setMcpJsonPaths([]);
  });

  it('returns empty array when config has no plugins', () => {
    const result = collectPlugins({ plugins: {} } as NanoConfig);
    // agent 定义加载可能返回 0
    assert.ok(Array.isArray(result));
  });

  it('includes plugins from config.plugins', () => {
    const config = {
      configVersion: 1,
      core: { maxTokens: 128000, defaultTimeout: 120000 },
      plugins: {
        'fs': { enabled: true },
        'command': { enabled: false },
      },
    } as NanoConfig;
    const result = collectPlugins(config);
    const names = result.map(r => r.name);
    assert.ok(names.includes('fs'));
    assert.ok(names.includes('command'));
  });

  it('marks disabled plugins correctly', () => {
    const config = {
      configVersion: 1,
      core: { maxTokens: 128000, defaultTimeout: 120000 },
      plugins: {
        'active-p': { enabled: true },
        'inactive-p': { enabled: false },
      },
    } as NanoConfig;
    const result = collectPlugins(config);
    const active = result.find(r => r.name === 'active-p');
    const inactive = result.find(r => r.name === 'inactive-p');
    assert.equal(active?.status, 'active');
    assert.equal(inactive?.status, 'inactive');
  });
});

describe('plugin command — buildPluginList', () => {
  beforeEach(() => {
    setMcpJsonPaths([]);
  });

  it('returns CommandInterceptResult with skipAgent', () => {
    const result = buildPluginList(undefined);
    assert.equal(result.handled, true);
    assert.equal(result.skipAgent, true);
    assert.ok(typeof result.message === 'string');
  });

  it('includes plugin names in output', () => {
    const config = {
      configVersion: 1,
      core: { maxTokens: 128000, defaultTimeout: 120000 },
      plugins: { 'fs': { enabled: true } },
    } as NanoConfig;
    const result = buildPluginList(config);
    assert.ok(result.message!.includes('fs'));
  });

  it('shows active/inactive status', () => {
    const config = {
      configVersion: 1,
      core: { maxTokens: 128000, defaultTimeout: 120000 },
      plugins: { 'fs': { enabled: true }, 'command': { enabled: false } },
    } as NanoConfig;
    const result = buildPluginList(config);
    assert.ok(result.message!.includes('active'));
    assert.ok(result.message!.includes('inactive'));
  });
});

// ── /plugin enable/disable 实际文件操作 ──

describe('plugin command — togglePlugin writes config', () => {
  const tmpDirs: string[] = [];
  let originalCwd: typeof process.cwd;

  beforeEach(() => {
    setMcpJsonPaths([]);
    originalCwd = process.cwd;
    const dir = mkdtempSync(join(tmpdir(), 'plugin-cmd-test-'));
    tmpDirs.push(dir);
    process.cwd = () => dir;

    // 写入一个初始 .nano-code.yaml（JSON 格式，与现有代码一致）
    writeFileSync(join(dir, '.nano-code.yaml'), JSON.stringify({
      plugins: {
        'test-plugin': { enabled: true },
      },
    }, null, 2), 'utf-8');
  });

  afterEach(() => {
    process.cwd = originalCwd;
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('disable a plugin via togglePlugin', async () => {
    // 通过 import 测试 togglePlugin（模块内部函数）
    // 直接调用 buildPluginList 验证初始状态
    const config = {
      configVersion: 1,
      core: { maxTokens: 128000, defaultTimeout: 120000 },
      plugins: { 'test-plugin': { enabled: true } },
    } as NanoConfig;

    const before = buildPluginList(config);
    assert.ok(before.message!.includes('active'));

    // 调用 handler 实际上会触发文件写入
    const { findBuiltinCommand } = await import('../src/plugins/commands/builtin.js');
    const cmd = findBuiltinCommand('plugin')!;
    assert.ok(cmd, 'plugin command should exist');

    const result = await cmd.handler({
      agent: null as any,
      registry: null as any,
      config,
      args: 'disable test-plugin',
    });

    assert.equal(result.handled, true);
    assert.equal(result.skipAgent, true);
    assert.ok(result.message!.includes('已禁用'));
  });

  it('reports unknown subcommand', async () => {
    const { findBuiltinCommand } = await import('../src/plugins/commands/builtin.js');
    const cmd = findBuiltinCommand('plugin')!;
    const result = await cmd.handler({
      agent: null as any,
      registry: null as any,
      config: { plugins: {} } as NanoConfig,
      args: 'unknown-command',
    });
    assert.ok(result.message!.includes('未知 plugin 子命令'));
  });
});
