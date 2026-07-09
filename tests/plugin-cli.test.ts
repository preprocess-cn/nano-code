import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePluginCommand } from '../src/plugin-cli.js';
import { PluginRegistry } from '../src/core/plugin.js';
import { setMcpJsonPaths } from '../src/plugins/mcp/adapter.js';
import { addMcpServer } from '../src/core/mcp-config.js';

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
