import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import * as yaml from 'js-yaml';
import { handlePluginCommand, _isNanoPlugin, _isDisplayPlugin, _deriveDisplayName, _installDisplayPlugin, _PRESENTATIONS_DIR, __setTestConfigPaths, _addToScopeConfig } from '../src/plugin-cli.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { setMcpJsonPaths } from '../src/plugins/mcp/adapter.js';
import { addMcpServer } from '../src/bootstrap/mcp-config.js';

// ── CLI 命令退出测试 ──
// 确保所有 plugin 子命令都能正常完成，不遗留孤儿进程。

describe('plugin CLI commands exit cleanly', () => {
  const tmpDirs: string[] = [];

  beforeEach(() => {
    setMcpJsonPaths([]); // 禁用 .mcp.json 扫描，避免干扰
  });

  afterEach(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('plugin list resolves', async () => {
    await handlePluginCommand(['list'], {});
  });

  it('plugin mcp-add resolves and writes .mcp.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-cli-test-'));
    tmpDirs.push(dir);
    const mcpJson = join(dir, '.mcp.json');

    addMcpServer(mcpJson, 'test-server', { command: 'echo', args: ['hello'] });

    const content = JSON.parse(fs.readFileSync(mcpJson, 'utf-8'));
    assert.equal(content.mcpServers['test-server'].command, 'echo');
    assert.deepEqual(content.mcpServers['test-server'].args, ['hello']);
  });

  it('plugin autoscan resolves when no claude config exists', async () => {
    await handlePluginCommand(['autoscan'], {});
  });
});

// ── --list-plugins 销毁测试 ──
// 验证 printPluginList 后 registry.destroy() 被调用（不遗留 MCP 子进程）

describe('list-plugins cleanup', () => {
  it('registry.destroy() cleans up after listing', async () => {
    let destroyed = false;

    const registry = new PluginRegistry();
    const mockPlugin = {
      name: 'test-plugin',
      getTools: () => [],
      execute: async () => ({ status: 'success' as const }),
      onDestroy: async () => { destroyed = true; },
    };

    await registry.register(mockPlugin);
    assert.equal(destroyed, false, 'onDestroy should not be called before destroy');

    await registry.destroy();
    assert.equal(destroyed, true, 'onDestroy should be called after destroy');
  });

  it('registry.destroy() handles MCP transport stop', async () => {
    // 模拟 MCP 插件的 onDestroy 调用 transport.stop()
    let stopped = false;

    const registry = new PluginRegistry();
    const mcpPlugin = {
      name: 'mcp:test-server',
      getTools: () => [],
      execute: async () => ({ status: 'success' as const }),
      onDestroy: async () => { stopped = true; },
    };

    await registry.register(mcpPlugin);
    await registry.destroy();
    assert.equal(stopped, true, 'MCP plugin transport.stop() should be called');
  });
});

// ── DisplayPlugin 检测 / 安装 ──

describe('isNanoPlugin', () => {
  it('returns true for valid NanoPlugin', () => {
    assert.equal(_isNanoPlugin({ name: 'test', execute: () => {} }), true);
  });

  it('returns false for null/undefined', () => {
    assert.equal(_isNanoPlugin(null), false);
    assert.equal(_isNanoPlugin(undefined), false);
  });

  it('returns false for plain object without execute', () => {
    assert.equal(_isNanoPlugin({ name: 'test' }), false);
  });

  it('returns false for DisplayPlugin without execute', () => {
    assert.equal(_isNanoPlugin({ name: 'test', onStreamChunk: () => {} }), false);
  });
});

describe('isDisplayPlugin', () => {
  it('returns true for plugin with onStreamChunk', () => {
    assert.equal(_isDisplayPlugin({ name: 'test', onStreamChunk: () => {} }), true);
  });

  it('returns true for plugin with onToolCall', () => {
    assert.equal(_isDisplayPlugin({ name: 'test', onToolCall: () => {} }), true);
  });

  it('returns true for plugin with ownsOutput boolean', () => {
    assert.equal(_isDisplayPlugin({ name: 'test', ownsOutput: true }), true);
  });

  it('returns true for plugin with prompt method', () => {
    assert.equal(_isDisplayPlugin({ name: 'test', prompt: async () => 'input' }), true);
  });

  it('returns false for null/undefined', () => {
    assert.equal(_isDisplayPlugin(null), false);
    assert.equal(_isDisplayPlugin(undefined), false);
  });

  it('returns false for plain NanoPlugin (no display indicators)', () => {
    const nano = { name: 'plugin', execute: () => {}, getTools: () => [] };
    assert.equal(_isDisplayPlugin(nano), false);
  });

  it('returns false for object without name', () => {
    assert.equal(_isDisplayPlugin({ onStreamChunk: () => {} }), false);
  });

  it('returns true for plugin with showPluginManager', () => {
    assert.equal(_isDisplayPlugin({ name: 'mgr', showPluginManager: () => {} }), true);
  });

  it('returns true for plugin with onAgentTurnStart', () => {
    assert.equal(_isDisplayPlugin({ name: 'a', onAgentTurnStart: () => {} }), true);
  });
});

describe('deriveDisplayName', () => {
  it('derives name from npm scoped spec', () => {
    assert.equal(_deriveDisplayName('@scope/nano-code-web'), 'nano-code-web');
  });

  it('derives name from simple npm spec', () => {
    assert.equal(_deriveDisplayName('my-plugin'), 'my-plugin');
  });

  it('derives name from git URL', () => {
    assert.equal(_deriveDisplayName('https://github.com/user/nano-code-web.git'), 'nano-code-web');
  });

  it('derives name from local path', () => {
    assert.equal(_deriveDisplayName('/home/user/projects/nano-code-web'), 'nano-code-web');
  });

  it('handles trailing slash', () => {
    assert.equal(_deriveDisplayName('/path/to/display-plugin/'), 'display-plugin');
  });
});

// ── YAML 格式验证 ──
// 验证 plugin enable/disable 写入项目配置时使用 YAML 而非 JSON（fix: JSON.parse/stringify 误用）
// 使用保存/恢复策略，不 mock

describe('project config YAML format', () => {
  const PROJECT_CONFIG_PATH = join(process.cwd(), '.nano-code.yaml');
  let origContent: string | null;

  beforeEach(() => {
    origContent = fs.existsSync(PROJECT_CONFIG_PATH)
      ? fs.readFileSync(PROJECT_CONFIG_PATH, 'utf-8')
      : null;
  });

  afterEach(() => {
    if (origContent !== null) {
      fs.writeFileSync(PROJECT_CONFIG_PATH, origContent, 'utf-8');
    } else {
      try { fs.rmSync(PROJECT_CONFIG_PATH); } catch { /* ignore */ }
    }
  });

  it('plugin enable writes YAML format (not JSON)', async () => {
    await handlePluginCommand(['enable', 'yaml-test-plugin'], {});

    const written = fs.readFileSync(PROJECT_CONFIG_PATH, 'utf-8');
    // 验证是 YAML 而非 JSON
    assert.ok(written.includes('plugins:'), 'output should contain plugins: key');
    assert.ok(written.includes('yaml-test-plugin:'), 'output should contain plugin name');
    assert.ok(written.includes('true'), 'output should contain enabled: true');
    assert.throws(
      () => JSON.parse(written),
      /SyntaxError|Unexpected|Expected/,
      'output should NOT be valid JSON',
    );
  });

  it('plugin disable writes YAML format (not JSON)', async () => {
    await handlePluginCommand(['disable', 'yaml-test-plugin'], {});

    const written = fs.readFileSync(PROJECT_CONFIG_PATH, 'utf-8');
    assert.ok(written.includes('plugins:'), 'output should contain plugins: key');
    assert.ok(written.includes('yaml-test-plugin:'), 'output should contain plugin name');
    assert.ok(written.includes('false'), 'output should contain enabled: false');
    assert.throws(
      () => JSON.parse(written),
      /SyntaxError|Unexpected|Expected/,
      'output should NOT be valid JSON',
    );
  });
});

// ── plugin install --scope / --user ──

describe('plugin install scope handling', () => {
  const TEST_PLUGIN = 'scope-test-pkg';
  let tmpDir: string;
  let globalConfigPath: string;
  let projectConfigPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plugin-scope-test-'));
    globalConfigPath = join(tmpDir, 'config.yaml');
    projectConfigPath = join(tmpDir, '.nano-code.yaml');
    // Create empty config files
    fs.writeFileSync(globalConfigPath, yaml.dump({ plugins: {} }), 'utf-8');
    fs.writeFileSync(projectConfigPath, yaml.dump({ plugins: {} }), 'utf-8');
    __setTestConfigPaths({ globalConfig: globalConfigPath, projectConfig: projectConfigPath, globalDir: tmpDir });
  });

  afterEach(() => {
    __setTestConfigPaths(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--scope user writes plugin entry to global config', async () => {
    const entry = { type: 'mcp', command: 'npx', args: ['-y', TEST_PLUGIN] };
    _addToScopeConfig(TEST_PLUGIN, entry, 'user');

    const globalRaw = fs.readFileSync(globalConfigPath, 'utf-8');
    const globalCfg = yaml.load(globalRaw) as Record<string, any>;
    assert.ok(globalCfg?.plugins?.[TEST_PLUGIN], 'plugin should be in global config');

    if (fs.existsSync(projectConfigPath)) {
      const projectRaw = fs.readFileSync(projectConfigPath, 'utf-8');
      const projectCfg = yaml.load(projectRaw) as Record<string, any>;
      assert.equal(projectCfg?.plugins?.[TEST_PLUGIN], undefined, 'plugin should NOT be in project config');
    }
  });

  it('--user global option writes plugin entry to global config', async () => {
    const entry = { type: 'mcp', command: 'npx', args: ['-y', TEST_PLUGIN] };
    _addToScopeConfig(TEST_PLUGIN, entry, 'user');

    const globalRaw = fs.readFileSync(globalConfigPath, 'utf-8');
    const globalCfg = yaml.load(globalRaw) as Record<string, any>;
    assert.ok(globalCfg?.plugins?.[TEST_PLUGIN], 'plugin should be in global config');
  });

  it('default (no scope) writes plugin entry to project config', async () => {
    const entry = { type: 'mcp', command: 'npx', args: ['-y', TEST_PLUGIN] };
    _addToScopeConfig(TEST_PLUGIN, entry, 'project');

    const projectRaw = fs.readFileSync(projectConfigPath, 'utf-8');
    const projectCfg = yaml.load(projectRaw) as Record<string, any>;
    assert.ok(projectCfg?.plugins?.[TEST_PLUGIN], 'plugin should be in project config');
  });

  it('--scope project writes plugin entry to project config', async () => {
    const entry = { type: 'mcp', command: 'npx', args: ['-y', TEST_PLUGIN] };
    _addToScopeConfig(TEST_PLUGIN, entry, 'project');

    const projectRaw = fs.readFileSync(projectConfigPath, 'utf-8');
    const projectCfg = yaml.load(projectRaw) as Record<string, any>;
    assert.ok(projectCfg?.plugins?.[TEST_PLUGIN], 'plugin should be in project config');

    if (fs.existsSync(globalConfigPath)) {
      const globalRaw = fs.readFileSync(globalConfigPath, 'utf-8');
      const globalCfg = yaml.load(globalRaw) as Record<string, any>;
      assert.equal(globalCfg?.plugins?.[TEST_PLUGIN], undefined, 'plugin should NOT be in global config');
    }
  });
});
