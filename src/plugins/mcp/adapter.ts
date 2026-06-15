import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { NanoPlugin, ToolCall } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';

// ── JSON-RPC types ──

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

// ── MCP Client ──

export class MCPClient {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private _name: string;
  private _description: string;

  get name(): string { return this._name; }
  get description(): string { return this._description; }

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    private initTimeout: number = 10000,
    private requestTimeout: number = 60000,
  ) {
    this._name = `mcp:${command}`;
    this._description = `MCP server: ${command} ${args.join(' ')}`;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP init timeout after ${this.initTimeout}ms`)), this.initTimeout);

      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env } as any,
        shell: true,
      });

      this.rl = readline.createInterface({ input: this.process.stdout! });
      this.rl.on('line', (line: string) => {
        line = line.trim();
        if (!line) return;
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch (e) {
          // Non-JSON output from server (e.g., startup logs) — ignore
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        // MCP servers may log to stderr; ignore by default
      });

      this.process.on('error', (err) => {
        this.clearPending(err);
        reject(err);
      });

      this.process.on('close', (code) => {
        this.clearPending(new Error(`MCP process exited with code ${code}`));
      });

      // Send initialize request
      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nano-code', version: '0.1.0' },
      }).then((result) => {
        clearTimeout(timer);
        // Send initialized notification
        this.notify('notifications/initialized', {});
        this._name = result.serverInfo?.name || this._name;
        this._description = result.serverInfo?.description || this._description;
        resolve();
      }).catch(reject);
    });
  }

  async listTools(): Promise<ToolDefinition[]> {
    const result = await this.request('tools/list', {});
    if (!result?.tools) return [];
    return result.tools.map((t: any) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  async callTool(name: string, args: any): Promise<any> {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) {
      const content = result.content?.[0]?.text || 'Unknown error';
      throw new Error(content);
    }
    return result?.content?.[0]?.text || JSON.stringify(result);
  }

  async stop(): Promise<void> {
    this.clearPending(new Error('MCP client stopped'));
    if (this.rl) { this.rl.close(); this.rl = null; }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private async request(method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    const msg: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
    const data = JSON.stringify(msg) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.process?.stdin?.write(data);
    });
  }

  private notify(method: string, params?: any): void {
    const msg: JSONRPCNotification = { jsonrpc: '2.0', method, params };
    this.process?.stdin?.write(JSON.stringify(msg) + '\n');
  }

  private handleMessage(msg: any): void {
    // Response to a pending request
    if (msg.id != null && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(`MCP error: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    // Notifications from server (no matching pending request) — ignore
  }

  private clearPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}

// ── Factory: create NanoPlugin from MCPClient ──

export function createMCPPlugin(client: MCPClient): NanoPlugin {
  let tools: ToolDefinition[] = [];

  return {
    name: client.name,
    description: client.description,

    getTools(): ToolDefinition[] {
      return tools;
    },

    async onInit(): Promise<void> {
      await client.start();
      tools = await client.listTools();
    },

    async onDestroy(): Promise<void> {
      await client.stop();
    },

    async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      try {
        const result = await client.callTool(name, args);
        return { status: 'success', data: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
      } catch (err: any) {
        return { status: 'error', message: err.message };
      }
    },
  };
}

// ── Load MCP plugins from config ──

import { NanoConfig } from '../../config.js';

export function buildMCPPluginsFromConfig(config: NanoConfig): NanoPlugin[] {
  const plugins: NanoPlugin[] = [];

  for (const [name, entry] of Object.entries(config.plugins)) {
    if (entry.type !== 'mcp' || entry.enabled === false) continue;
    if (!entry.command) {
      console.warn(`[mcp] MCP plugin "${name}" has no "command" configured, skipping.`);
      continue;
    }

    const client = new MCPClient(
      entry.command,
      entry.args || [],
      entry.env || {},
      entry.initTimeout ?? 10000,
    );
    plugins.push(createMCPPlugin(client));
  }

  return plugins;
}
