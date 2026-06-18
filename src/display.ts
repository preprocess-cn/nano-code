import { PluginRegistry } from './plugin.js';

// ════════════════════════════════════════════
// 结构化事件类型
// ════════════════════════════════════════════

export interface StartConfig {
  greeting: string;
  agentName: string;
  profileName?: string;
  hasTools: boolean;
}

export interface AgentEvent {
  agentName: string;
}

export interface StatusEvent extends AgentEvent {
  message: string;
}

export interface StreamEvent extends AgentEvent {
  text: string;
}

export interface ToolCallEvent extends AgentEvent {
  toolName: string;
  args: any;
}

export interface ToolResultEvent extends AgentEvent {
  status: 'success' | 'error' | 'rejected_by_user';
  message?: string;
}

export interface ErrorEvent extends AgentEvent {
  message: string;
  stack?: string;
}

export interface DebugEvent extends AgentEvent {
  data: string;
}

export function isMainAgent(agentName: string): boolean {
  return agentName === 'main';
}

// ════════════════════════════════════════════
// DisplayPlugin — 展示层插件接口
// ════════════════════════════════════════════

export interface DisplayPlugin {
  name: string;

  onStart?(config: StartConfig): void;
  onStop?(message: string): void;

  /** 返回用户输入，null 表示无输入 */
  prompt?(): Promise<string | null>;

  onUserInput?(input: string, sourcePlugin: string): void;

  onStatus?(event: StatusEvent): void;
  onStreamChunk?(event: StreamEvent): void;
  onToolCall?(event: ToolCallEvent): void;
  onToolResult?(event: ToolResultEvent): void;
  onError?(event: ErrorEvent): void;
  onDebug?(event: DebugEvent): void;
}

// ════════════════════════════════════════════
// DisplayManager — 多展示层管理器
// ════════════════════════════════════════════

export class DisplayManager {
  private plugins: DisplayPlugin[] = [];

  addPlugin(plugin: DisplayPlugin): void {
    this.plugins.push(plugin);
  }

  removePlugin(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name);
  }

  clearPlugins(): void {
    this.plugins = [];
  }

  getPluginNames(): string[] {
    return this.plugins.map(p => p.name);
  }

  get count(): number {
    return this.plugins.length;
  }

  start(config: StartConfig): void {
    for (const p of this.plugins) p.onStart?.(config);
  }

  stop(message: string): void {
    for (const p of this.plugins) p.onStop?.(message);
  }

  async prompt(): Promise<string | null> {
    for (const plugin of this.plugins) {
      const result = await plugin.prompt?.();
      if (result !== null && result !== undefined) {
        for (const p of this.plugins) p.onUserInput?.(result, plugin.name);
        return result;
      }
    }
    return null;
  }

  onStatus(event: StatusEvent): void {
    for (const p of this.plugins) p.onStatus?.(event);
  }

  onStreamChunk(event: StreamEvent): void {
    for (const p of this.plugins) p.onStreamChunk?.(event);
  }

  onToolCall(event: ToolCallEvent): void {
    for (const p of this.plugins) p.onToolCall?.(event);
  }

  onToolResult(event: ToolResultEvent): void {
    for (const p of this.plugins) p.onToolResult?.(event);
  }

  onError(event: ErrorEvent): void {
    for (const p of this.plugins) p.onError?.(event);
  }

  onDebug(event: DebugEvent): void {
    for (const p of this.plugins) p.onDebug?.(event);
  }
}

// ════════════════════════════════════════════
// printPluginList — 插件列表打印（非事件，保留）
// ════════════════════════════════════════════

export function printPluginList(registry: PluginRegistry): void {
  const plugins = registry.listPlugins();
  if (plugins.length === 0) {
    console.log('\n  当前没有注册任何插件。\n');
    return;
  }

  console.log(`\n  已注册插件 (${plugins.length}):\n`);
  for (const p of plugins) {
    const tag = p.name.startsWith('mcp:') ? 'MCP' : p.name.startsWith('agent:') ? 'agent' : '内置';
    console.log(`  ${p.name} [${tag}]`);
    if (p.description) {
      console.log(`   〉${p.description}`);
    }
    const tools = p.tools;
    if (tools.length > 0) {
      for (const t of tools) {
        const desc = t.function.description.replace(/\n.*/s, '').slice(0, 80);
        console.log(`    • ${t.function.name.padEnd(22)} ${desc}`);
      }
    } else {
      console.log(`    (无工具 — 仅挂载钩子)`);
    }
    console.log('');
  }
}
