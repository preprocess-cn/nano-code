import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NanoPlugin } from '../../core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../core/contract.js';
import { NanoConfig } from '../../core/config.js';
import { getPackageVersion } from '../../core/version.js';
import { withRetry } from '../../core/retry.js';

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

// ── Retry config for MCP transport startup ──

const MCP_RETRY_OPTIONS = {
  maxRetries: 2,
  delaysMs: [500, 1500],
  label: 'mcp',
  isTransient: (err: unknown) => {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('refused') || msg.includes('econnreset')) return true;
    if (msg.includes('timeout') || msg.includes('init timeout')) return true;
    if (msg.includes('process exited')) return true;
    if (/http (5\d\d)/.test(msg)) return true;
    return false;
  },
};

// ── MCP stderr log level filtering ──

const LOG_LEVELS: Record<string, number> = {
  trace: 0, debug: 0, info: 1, warn: 2, error: 3,
  fatal: 4, critical: 4, panic: 4,
};

/**
 * 判断 MCP 子进程的 stderr 文本是否应该显示给用户。
 *
 * 识别的格式：
 *  - Go slog/logrus: level=info msg="..."
 *  - JSON: {"level":"info",...}
 *  - 未知格式：放行（保守策略，宁可过曝不丢信息）
 */
export function shouldShowStderr(text: string, threshold: string): boolean {
  const thresholdNum = LOG_LEVELS[threshold] ?? 2; // default warn
  let lvl: string | undefined;

  // Go slog/logrus: level=info msg="..."
  const m = text.match(/\blevel=(\w+)\b/i);
  if (m) lvl = m[1].toLowerCase();

  // JSON: {"level":"info",...}
  if (!lvl) {
    try {
      const j = JSON.parse(text);
      if (j?.level) lvl = String(j.level).toLowerCase();
    } catch { /* not JSON */ }
  }

  if (lvl) {
    const lvlNum = LOG_LEVELS[lvl] ?? 0;
    return lvlNum >= thresholdNum;
  }

  // Unknown format — pass through
  return true;
}

// ── Cleanup helper for abort controller ──

function delaySignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

// ── Transport interface ──

export interface MCPTransport {
  readonly name: string;
  readonly description: string;
  start(): Promise<void>;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: any): Promise<any>;
  stop(): Promise<void>;
}

// ── Stdio transport ──

export class MCPStdioTransport implements MCPTransport {
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
    private stderrLevel: string = 'warn',
  ) {
    this._name = `mcp:${command}`;
    this._description = `MCP server: ${command} ${args.join(' ')}`;
  }

  async start(): Promise<void> {
    return withRetry(async () => {
      await this.startInner();
    }, MCP_RETRY_OPTIONS);
  }

  private async startInner(): Promise<void> {
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
        } catch {
          // Non-JSON output from server (e.g., startup logs) — ignore
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trimEnd();
        if (text && shouldShowStderr(text, this.stderrLevel)) {
          console.error(`[mcp:stderr] ${text}`);
        }
      });

      this.process.on('error', (err) => {
        this.clearPending(err);
        reject(err);
      });

      this.process.on('close', (code, signal) => {
        if (code !== null && code !== 0) {
          console.warn(`[mcp] 进程 "${this.command}" 已退出，退出码: ${code} (信号: ${signal || 'none'})`);
        }
        this.clearPending(new Error(`MCP process exited with code ${code}`));
      });

      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nano-code', version: getPackageVersion() },
      }).then((result) => {
        clearTimeout(timer);
        this.notify('notifications/initialized', {});
        this._name = result.serverInfo?.name || this._name;
        this._description = result.serverInfo?.description || this._description;
        resolve();
      }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
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
      this.process.kill('SIGTERM');
      // 等待进程退出，3 秒后强制 SIGKILL
      const proc = this.process;
      const pid = proc.pid;
      if (pid != null) {
        const exited = new Promise<void>(resolve => {
          proc.once('close', () => resolve());
          proc.once('error', () => resolve());
        });
        const timeout = setTimeout(() => {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
        }, 3000);
        await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
        clearTimeout(timeout);
      }
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
    const msg = { jsonrpc: '2.0' as const, method, params };
    this.process?.stdin?.write(JSON.stringify(msg) + '\n');
  }

  private handleMessage(msg: any): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(`MCP error: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  private clearPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}

// ── HTTP transport ──

export class MCPHTTPTransport implements MCPTransport {
  private nextId = 1;
  private sessionId: string | null = null;
  private _name: string;
  private _description: string;
  private initTimeout: number;
  private requestTimeout: number;

  get name(): string { return this._name; }
  get description(): string { return this._description; }

  constructor(
    private url: string,
    initTimeout: number = 10000,
    requestTimeout: number = 60000,
  ) {
    this._name = `mcp:http`;
    this._description = `MCP HTTP server: ${url}`;
    this.initTimeout = initTimeout;
    this.requestTimeout = requestTimeout;
  }

  async start(): Promise<void> {
    return withRetry(async () => {
      await this.startInner();
    }, MCP_RETRY_OPTIONS);
  }

  private async startInner(): Promise<void> {
    const { signal, clear } = delaySignal(this.initTimeout);
    try {
      const result = await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nano-code', version: getPackageVersion() },
      }, signal);

      if (result && typeof result === 'object' && '_sessionId' in result) {
        this.sessionId = result._sessionId;
      }

      this._name = result.serverInfo?.name || this._name;
      this._description = result.serverInfo?.description || this._description;

      this.notify('notifications/initialized', {}).catch(() => {});
    } finally {
      clear();
    }
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
    // No persistent connection to close
  }

  private async request(method: string, params?: any, signal?: AbortSignal): Promise<any> {
    const id = this.nextId++;
    const body: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

    const defaultSignal = delaySignal(this.requestTimeout);
    const activeSignal = signal || defaultSignal.signal;

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: activeSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        const text = await response.text();
        return this.handleSSEResponse(text, id);
      }

      const json = await response.json() as JSONRPCResponse;
      if (json.error) {
        throw new Error(`MCP error: ${json.error.message}`);
      }
      return json.result;
    } finally {
      if (!signal) defaultSignal.clear();
    }
  }

  private async notify(method: string, params?: any): Promise<void> {
    const body = { jsonrpc: '2.0' as const, method, params };
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Notifications are fire-and-forget
    }
  }

  private handleSSEResponse(text: string, requestId: number): any {
    const events = parseSSE(text);
    for (const evt of events) {
      try {
        const data = JSON.parse(evt.data);
        if (data.id === requestId) {
          if (data.error) throw new Error(`MCP error: ${data.error.message}`);
          return data.result;
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('MCP error:')) throw err;
      }
    }
    throw new Error('No matching response in SSE stream');
  }
}

function parseSSE(text: string): Array<{ event?: string; data: string }> {
  const events: Array<{ event?: string; data: string }> = [];
  const blocks = text.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    let event: string | undefined;
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice(7);
      } else if (line.startsWith('data: ')) {
        data += (data ? '\n' : '') + line.slice(6);
      }
    }
    if (data) events.push({ event, data });
  }
  return events;
}

// ── Factory: create NanoPlugin from MCPTransport ──

export function createMCPPlugin(transport: MCPTransport, sideEffect = true): NanoPlugin {
  let tools: ToolDefinition[] = [];

  return {
    name: transport.name,
    description: transport.description,

    getTools(): ToolDefinition[] {
      return tools.map(t => ({
        ...t,
        function: { ...t.function, sideEffect },
      }));
    },

    async onInit(): Promise<void> {
      await transport.start();
      tools = await transport.listTools();
    },

    async onDestroy(): Promise<void> {
      await transport.stop();
    },

    async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      try {
        const result = await transport.callTool(name, args);
        return { status: 'success', data: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
      } catch (err: any) {
        return { status: 'error', message: err.message };
      }
    },
  };
}

// ── Read .mcp.json helpers ──

function readMcpJsonServers(filePath: string): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers !== null)
      ? parsed.mcpServers
      : null;
  } catch { return null; }
}

let _mcpJsonPaths: string[] | null = null;

/** 覆盖 .mcp.json 扫描路径（用于测试或自定义配置）。设为空数组可禁用扫描。 */
export function setMcpJsonPaths(paths: string[]): void {
  _mcpJsonPaths = paths;
}

function getMcpJsonPaths(): string[] {
  if (_mcpJsonPaths !== null) return _mcpJsonPaths;
  return [
    path.join(os.homedir(), '.nano-code', '.mcp.json'),   // nano-code 全局
    path.join(process.cwd(), '.mcp.json'),                   // 项目配置
    path.join(os.homedir(), '.claude', '.mcp.json'),         // Claude Code 全局（只读发现）
  ];
}

// ── Load MCP plugins from config + .mcp.json ──

export function buildMCPPluginsFromConfig(config: NanoConfig, debug = false): NanoPlugin[] {
  const stderrLevel = debug ? 'debug' : (config.mcp?.stderrLevel || 'warn');
  const plugins: NanoPlugin[] = [];

  // Phase 1: From nano-code config.plugins
  for (const [name, entry] of Object.entries(config.plugins)) {
    if (entry.type !== 'mcp' || entry.enabled === false) continue;

    const transport = entry.transport || 'stdio';

    let mcpTransport: MCPTransport;

    if (transport === 'http') {
      if (!entry.url) {
        console.warn(`[mcp] HTTP MCP 插件 "${name}" 未配置 "url"，跳过。`);
        continue;
      }
      mcpTransport = new MCPHTTPTransport(entry.url, entry.initTimeout ?? 10000);
    } else {
      if (!entry.command) {
        console.warn(`[mcp] MCP 插件 "${name}" 未配置 "command"，跳过。`);
        continue;
      }
      mcpTransport = new MCPStdioTransport(
        entry.command,
        entry.args || [],
        entry.env || {},
        entry.initTimeout ?? 10000,
        60000,
        stderrLevel,
      );
    }

    plugins.push(createMCPPlugin(mcpTransport, entry.sideEffect ?? true));
  }

  // Phase 2: From .mcp.json 文件（nano-code 全局 → 项目 → Claude Code 全局）
  // seenByEntry 跟踪 .mcp.json 中已注册的 server 名（防止跨文件重复）
  const seenByEntry = new Set<string>();
  for (const [name, entry] of Object.entries(config.plugins)) {
    if (entry.type === 'mcp' && entry.enabled !== false) seenByEntry.add(name);
  }

  for (const filePath of getMcpJsonPaths()) {
    const servers = readMcpJsonServers(filePath);
    if (!servers) continue;

    for (const [name, cfg] of Object.entries(servers)) {
      if (seenByEntry.has(name)) continue;
      seenByEntry.add(name);

      // 用户通过 nano-code config 显式禁用 → 跳过
      const override = config.plugins[name];
      if (override?.enabled === false) continue;

      let mcpTransport: MCPTransport;

      if (cfg.url) {
        mcpTransport = new MCPHTTPTransport(cfg.url, 10000);
      } else if (cfg.command) {
        mcpTransport = new MCPStdioTransport(cfg.command, cfg.args || [], cfg.env || {}, 10000, 60000, stderrLevel);
      } else {
        console.warn(`[mcp] .mcp.json "${name}" 缺少 command 或 url，跳过。`);
        continue;
      }

      plugins.push(createMCPPlugin(mcpTransport, true));
    }
  }

  return plugins;
}
