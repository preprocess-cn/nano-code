import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { NanoPlugin } from '../src/core/plugin.js';
import { ToolDefinition, ToolResponse } from '../src/core/contract.js';
import { createFilteredPlugin, createReadonlyCommandPlugin } from '../src/plugins/explore/tool-utils.js';

/**
 * 创建一个 mock 插件用于测试。
 */
function createMockPlugin(name: string, toolDefs: ToolDefinition[]): NanoPlugin {
  return {
    name,
    description: `Mock ${name}`,
    version: '1.0.0',

    getTools(): ToolDefinition[] {
      return toolDefs;
    },

    async execute(execName: string, _args: any): Promise<ToolResponse> {
      if (execName === 'run_bash_command') {
        return { status: 'success', data: `executed: ${_args.command}` };
      }
      return { status: 'success', data: `ok: ${execName}` };
    },

    onSystemPrompt(p: string): string {
      return p + `\n[${name} hook]`;
    },

    onBeforeRequest(msgs: any[]): any[] {
      return msgs;
    },
  };
}

// ── createFilteredPlugin ──

describe('createFilteredPlugin', () => {
  const allTools: ToolDefinition[] = [
    {
      type: 'function',
      function: { name: 'read_tool', description: 'read', parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function',
      function: { name: 'write_tool', description: 'write', sideEffect: true, parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function',
      function: { name: 'patch_tool', description: 'patch', sideEffect: true, parameters: { type: 'object', properties: {} } },
    },
  ];

  const mockPlugin = createMockPlugin('test-fs', allTools);

  it('只暴露 allowedTools 中的工具', () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set(['read_tool', 'write_tool']));
    const tools = filtered.getTools();
    assert.equal(tools.length, 2);
    assert.equal(tools[0].function.name, 'read_tool');
    assert.equal(tools[1].function.name, 'write_tool');
  });

  it('不在 allowedTools 中的工具被隐藏', () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set(['read_tool']));
    const tools = filtered.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'read_tool');
    assert.ok(!tools.some(t => t.function.name === 'write_tool'));
    assert.ok(!tools.some(t => t.function.name === 'patch_tool'));
  });

  it('execute 透传到原插件', async () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set(['read_tool']));
    const result = await filtered.execute('read_tool', {}, { skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false });
    assert.equal(result.status, 'success');
    assert.ok(result.data?.includes('read_tool'));
  });

  it('保留插件名和描述', () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set(['read_tool']));
    assert.equal(filtered.name, 'test-fs');
    assert.equal(filtered.description, 'Mock test-fs');
  });

  it('代理 onSystemPrompt 钩子', () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set(['read_tool']));
    const result = filtered.onSystemPrompt?.('base');
    assert.equal(result, 'base\n[test-fs hook]');
  });

  it('空 allowedTools 返回空工具列表', () => {
    const filtered = createFilteredPlugin(mockPlugin, new Set());
    assert.equal(filtered.getTools().length, 0);
  });
});

// ── createReadonlyCommandPlugin ──

describe('createReadonlyCommandPlugin', () => {
  const bashTool: ToolDefinition = {
    type: 'function',
    function: {
      name: 'run_bash_command',
      description: 'Execute a bash command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  };

  const cmdPlugin = createMockPlugin('command', [bashTool]);
  const readOnlyPlugin = createReadonlyCommandPlugin(cmdPlugin);

  it('保留工具定义', () => {
    const tools = readOnlyPlugin.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'run_bash_command');
  });

  it('放行只读命令', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'ls -la' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'success');
  });

  it('放行 git log 等只读 git 命令', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'git log --oneline -5' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'success');
  });

  it('拦截 rm 等写命令并返回错误', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'rm -rf node_modules' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('只读模式'));
  });

  it('拦截 npm install 等写命令', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'npm install' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('只读模式'));
  });

  it('拦截带重定向的命令', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'echo hello > file.txt' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('只读模式'));
  });

  it('拦截 mkdir 命令', async () => {
    const result = await readOnlyPlugin.execute('run_bash_command', { command: 'mkdir -p dist' }, {
      skipPermission: true, cwd: '', defaultTimeout: 30000, sideEffect: false,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('只读模式'));
  });

  it('保留插件名和描述', () => {
    assert.equal(readOnlyPlugin.name, 'command');
    assert.equal(readOnlyPlugin.description, 'Mock command');
  });

  it('代理 onSystemPrompt 钩子', () => {
    const result = readOnlyPlugin.onSystemPrompt?.('base');
    assert.equal(result, 'base\n[command hook]');
  });
});
