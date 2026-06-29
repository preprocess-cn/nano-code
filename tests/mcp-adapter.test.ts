import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MCPStdioTransport, createMCPPlugin, buildMCPPluginsFromConfig } from '../src/plugins/mcp/adapter.js';
import type { MCPTransport } from '../src/plugins/mcp/adapter.js';
import { NanoConfig } from '../src/core/config.js';

// ── Temp file helpers (avoid shell quoting issues with inline -e scripts) ──

const tmpScripts: string[] = [];

function createTestScript(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  const file = join(dir, 'server.js');
  writeFileSync(file, script);
  tmpScripts.push(dir);
  return file;
}

function cleanupScripts(): void {
  for (const dir of tmpScripts) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpScripts.length = 0;
}

// ── MCP stdio test server: handles initialize, tools/list, tools/call ──

function stdioServerScript(): string {
  return `
const rl = require('readline').createInterface({input:process.stdin});
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'test-server',version:'1.0.0'},capabilities:{}}}) + '\\n');
  } else if (m.method === 'tools/list') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'Echo test',inputSchema:{type:'object',properties:{arg:{type:'string'}}}}]}}) + '\\n');
  } else if (m.method === 'tools/call') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(m.params.arguments)}]}}) + '\\n');
  }
});
`;
}

function stderrServerScript(): string {
  return `
process.stderr.write('starting up...\\n');
const rl = require('readline').createInterface({input:process.stdin});
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'stderr-test',version:'1.0.0'},capabilities:{}}}) + '\\n');
  } else if (m.method === 'tools/list') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[]}}) + '\\n');
  }
});
`;
}

// ── Test lifecycle ──

afterEach(() => {
  cleanupScripts();
});

// ── Tests ──

describe('MCPStdioTransport', () => {
  it('connects and lists tools', async () => {
    const scriptPath = createTestScript(stdioServerScript());
    const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 1000);

    await transport.start();
    assert.equal(transport.name, 'test-server');

    const tools = await transport.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'echo');

    await transport.stop();
  });

  it('calls a tool and returns result', async () => {
    const scriptPath = createTestScript(stdioServerScript());
    const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 1000);

    await transport.start();
    const result = await transport.callTool('echo', { arg: 'hello' });
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('hello'));

    await transport.stop();
  });

  it('logs stderr from child process', async () => {
    const captured: string[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => captured.push(args.join(' '));

    try {
      const scriptPath = createTestScript(stderrServerScript());
      const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 1000);
      await transport.start();
      await transport.stop();
    } finally {
      console.error = origError;
    }

    assert.ok(captured.some(m => m.includes('[mcp:stderr]') && m.includes('starting up')), 'should capture stderr output');
  });

  it('propagates transport start error through plugin wrapper', async () => {
    const mockTransport: MCPTransport = {
      name: 'mock-fail',
      description: 'Mock transport that fails',
      async start() { throw new Error('process exited with code 1'); },
      async listTools() { return []; },
      async callTool() { return ''; },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await assert.rejects(() => plugin.onInit!(undefined as any), /process exited/);
  });

  it('propagates persistent start error through plugin wrapper', async () => {
    let callCount = 0;
    const mockTransport: MCPTransport = {
      name: 'mock-always-fail',
      description: 'Mock transport that always fails',
      async start() { callCount++; throw new Error('always fails'); },
      async listTools() { return []; },
      async callTool() { return ''; },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await assert.rejects(() => plugin.onInit!(undefined as any), /always fails/);
    assert.equal(callCount, 1, 'start should be called exactly once (no retry in wrapper)');
  });
});

describe('MCPHTTPTransport', () => {
  it('wraps HTTP transport as plugin (via mock)', async () => {
    const mockTransport: MCPTransport = {
      name: 'mcp:http-test',
      description: 'Mock HTTP transport',
      async start() {},
      async listTools() {
        return [{ type: 'function', function: { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } } }];
      },
      async callTool(name: string, args: any) { return 'pong'; },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await plugin.onInit!(undefined as any);
    const tools = plugin.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'echo');

    const result = await plugin.execute('echo', {}, { skipPermission: true, cwd: process.cwd(), defaultTimeout: 5000, sideEffect: true });
    assert.equal(result.status, 'success');
    assert.equal(result.data, 'pong');
    await plugin.onDestroy!();
  });

  it('propagates start error through plugin wrapper', async () => {
    const mockTransport: MCPTransport = {
      name: 'mock-http-fail',
      description: 'Mock HTTP transport',
      async start() { throw new Error('HTTP 503: Service Unavailable'); },
      async listTools() { return []; },
      async callTool() { return ''; },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await assert.rejects(() => plugin.onInit!(undefined as any), /HTTP 503/);
  });

  it('propagates persistent HTTP start error through plugin wrapper', async () => {
    let callCount = 0;
    const mockTransport: MCPTransport = {
      name: 'mock-http-always-fail',
      description: 'Mock HTTP transport that always fails',
      async start() { callCount++; throw new Error('always down'); },
      async listTools() { return []; },
      async callTool() { return ''; },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await assert.rejects(() => plugin.onInit!(undefined as any), /always down/);
    assert.equal(callCount, 1, 'start should be called exactly once');
  });
});

describe('createMCPPlugin', () => {
  it('wraps a transport into a NanoPlugin', async () => {
    let started = false;
    let stopped = false;

    const mockTransport: MCPTransport = {
      name: 'mock',
      description: 'Mock transport',
      async start() { started = true; },
      async listTools() {
        return [{ type: 'function', function: { name: 'mock_tool', description: 'Mock', parameters: {} } }];
      },
      async callTool(name: string, args: any) { return 'mock result'; },
      async stop() { stopped = true; },
    };

    const plugin = createMCPPlugin(mockTransport);
    assert.equal(plugin.name, 'mock');
    assert.equal(plugin.description, 'Mock transport');

    await plugin.onInit!(undefined as any);
    assert.ok(started, 'transport.start() should be called');

    const tools = plugin.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'mock_tool');

    const result = await plugin.execute('mock_tool', {}, { skipPermission: true, cwd: process.cwd(), defaultTimeout: 5000, sideEffect: true });
    assert.equal(result.status, 'success');

    await plugin.onDestroy!();
    assert.ok(stopped, 'transport.stop() should be called');
  });

  it('returns error when tool call fails', async () => {
    const mockTransport: MCPTransport = {
      name: 'failing',
      description: 'Failing transport',
      async start() {},
      async listTools() { return []; },
      async callTool(name: string, args: any) { throw new Error('tool failure'); },
      async stop() {},
    };

    const plugin = createMCPPlugin(mockTransport);
    await plugin.onInit!(undefined as any);

    const result = await plugin.execute('any_tool', {}, { skipPermission: true, cwd: process.cwd(), defaultTimeout: 5000, sideEffect: true });
    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('tool failure'));
  });
});

describe('buildMCPPluginsFromConfig', () => {
  it('builds stdio plugin from config', () => {
    const config: NanoConfig = {
      configVersion: 1,
      core: { model: 'gpt-4o', temperature: 0, maxTokens: 4096, defaultTimeout: 120000 },
      plugins: {
        'my-server': { type: 'mcp', command: 'echo', enabled: true },
      },
    };

    const plugins = buildMCPPluginsFromConfig(config);
    assert.equal(plugins.length, 1);
    assert.ok(plugins[0].name.startsWith('mcp:'));
  });

  it('builds HTTP plugin from config', () => {
    const config: NanoConfig = {
      configVersion: 1,
      core: { model: 'gpt-4o', temperature: 0, maxTokens: 4096, defaultTimeout: 120000 },
      plugins: {
        'http-server': { type: 'mcp', transport: 'http', url: 'http://127.0.0.1:8080', enabled: true },
      },
    };

    const plugins = buildMCPPluginsFromConfig(config);
    assert.equal(plugins.length, 1);
    assert.ok(plugins[0].name.startsWith('mcp:http'));
  });

  it('skips disabled plugins', () => {
    const config: NanoConfig = {
      configVersion: 1,
      core: { model: 'gpt-4o', temperature: 0, maxTokens: 4096, defaultTimeout: 120000 },
      plugins: {
        'disabled-server': { type: 'mcp', command: 'echo', enabled: false },
      },
    };

    const plugins = buildMCPPluginsFromConfig(config);
    assert.equal(plugins.length, 0);
  });

  it('skips HTTP plugin without url', () => {
    const config: NanoConfig = {
      configVersion: 1,
      core: { model: 'gpt-4o', temperature: 0, maxTokens: 4096, defaultTimeout: 120000 },
      plugins: {
        'bad-http': { type: 'mcp', transport: 'http', enabled: true },
      },
    };

    const plugins = buildMCPPluginsFromConfig(config);
    assert.equal(plugins.length, 0);
  });
});
