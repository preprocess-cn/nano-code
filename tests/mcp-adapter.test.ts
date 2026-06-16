import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import { writeFileSync, mkdtempSync, unlinkSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MCPStdioTransport, MCPHTTPTransport, createMCPPlugin, buildMCPPluginsFromConfig } from '../src/plugins/mcp/adapter.js';
import type { MCPTransport } from '../src/plugins/mcp/adapter.js';
import { NanoConfig } from '../src/config.js';

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

// ── HTTP test MCP server ──

function createMCPServer(handler?: (msg: any) => any): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let body = '';
      for await (const chunk of req) body += chunk;
      const msg = JSON.parse(body);

      if (handler) {
        const customResult = handler(msg);
        if (customResult) {
          if (typeof customResult.statusCode === 'number') {
            res.writeHead(customResult.statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(customResult.body || {}));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: customResult }));
          return;
        }
      }

      let result: any;
      if (msg.method === 'initialize') {
        result = { protocolVersion: '2024-11-05', serverInfo: { name: 'http-test', version: '1.0.0' }, capabilities: {} };
      } else if (msg.method === 'tools/list') {
        result = { tools: [{ name: 'echo', description: 'Echo test', inputSchema: { type: 'object', properties: { arg: { type: 'string' } } } }] };
      } else if (msg.method === 'tools/call') {
        result = { content: [{ type: 'text', text: 'pong' }] };
      } else {
        result = {};
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

// ── Test lifecycle ──

let servers: http.Server[] = [];

afterEach(() => {
  cleanupScripts();
  for (const srv of servers) srv.close();
  servers = [];
});

// ── Tests ──

describe('MCPStdioTransport', () => {
  it('connects and lists tools', async () => {
    const scriptPath = createTestScript(stdioServerScript());
    const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 5000);

    await transport.start();
    assert.equal(transport.name, 'test-server');

    const tools = await transport.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'echo');

    await transport.stop();
  });

  it('calls a tool and returns result', async () => {
    const scriptPath = createTestScript(stdioServerScript());
    const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 5000);

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
      const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 5000);
      await transport.start();
      await transport.stop();
    } finally {
      console.error = origError;
    }

    assert.ok(captured.some(m => m.includes('[mcp:stderr]') && m.includes('starting up')), 'should capture stderr output');
  });

  it('retries on process crash', async () => {
    const counterFile = join(tmpdir(), `mcp-retry-${Date.now()}-${Math.random()}`);
    const script = `
const fs = require('fs');
let count = 0;
try { count = parseInt(fs.readFileSync('${counterFile}', 'utf-8')) || 0; } catch(e) {}
count++;
fs.writeFileSync('${counterFile}', String(count));
if (count < 2) { process.exit(1); }
const rl = require('readline').createInterface({input:process.stdin});
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'retry-test',version:'1.0.0'},capabilities:{}}}) + '\\n');
  } else if (m.method === 'tools/list') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[]}}) + '\\n');
  }
});
`;
    const scriptPath = createTestScript(script);

    try {
      const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 5000);
      await transport.start();
      assert.equal(transport.name, 'retry-test');
      await transport.stop();

      const count = parseInt(readFileSync(counterFile, 'utf-8'));
      assert.ok(count >= 2, `expected at least 2 attempts, got ${count}`);
    } finally {
      try { unlinkSync(counterFile); } catch {}
    }
  });

  it('fails after max retries on persistent crash', async () => {
    const script = `process.exit(1);`;
    const scriptPath = createTestScript(script);
    const transport = new MCPStdioTransport(process.execPath, [scriptPath], {}, 3000);

    await assert.rejects(() => transport.start(), /process exited/);
  });
});

describe('MCPHTTPTransport', () => {
  it('connects and lists tools', async () => {
    const s = await createMCPServer();
    servers.push(s.server);

    const transport = new MCPHTTPTransport(`http://127.0.0.1:${s.port}`, 5000);
    await transport.start();
    assert.equal(transport.name, 'http-test');

    const tools = await transport.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'echo');

    await transport.stop();
  });

  it('calls a tool and returns result', async () => {
    const s = await createMCPServer();
    servers.push(s.server);

    const transport = new MCPHTTPTransport(`http://127.0.0.1:${s.port}`, 5000);
    await transport.start();

    const result = await transport.callTool('echo', { arg: 'hello' });
    assert.equal(result, 'pong');

    await transport.stop();
  });

  it('retries on transient server error', async () => {
    let attemptCount = 0;
    const s = await createMCPServer((msg) => {
      if (msg.method !== 'initialize') return null;
      attemptCount++;
      if (attemptCount === 1) return { statusCode: 503, body: { error: 'Service Unavailable' } };
      return null; // use default handler
    });
    servers.push(s.server);

    const transport = new MCPHTTPTransport(`http://127.0.0.1:${s.port}`, 5000);
    await transport.start();
    assert.equal(transport.name, 'http-test');
    assert.ok(attemptCount >= 2, `expected retry, got ${attemptCount} attempts`);

    await transport.stop();
  });

  it('fails after max retries on persistent error', async () => {
    const s = await createMCPServer((msg) => {
      if (msg.method === 'initialize') return { statusCode: 503, body: { error: 'Always Down' } };
      return null;
    });
    servers.push(s.server);

    const transport = new MCPHTTPTransport(`http://127.0.0.1:${s.port}`, 5000);
    await assert.rejects(() => transport.start(), /HTTP 503/);
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
      core: { model: 'gpt-4o', temperature: 0, maxTokens: 4096, defaultTimeout: 120000 },
      plugins: {
        'bad-http': { type: 'mcp', transport: 'http', enabled: true },
      },
    };

    const plugins = buildMCPPluginsFromConfig(config);
    assert.equal(plugins.length, 0);
  });
});
