import { PluginRegistry } from '#src/core/plugin.js';
import type { NanoConfig } from '#src/core/config.js';
import type { ToolStatus, AgentDisplay } from '#src/core/contract.js';
import type { ContextAnalysis } from '#src/plugins/token-budget/analyzer.js';

// ════════════════════════════════════════════
// 结构化事件类型
// ════════════════════════════════════════════

export interface StartConfig {
  greeting: string;
  agentName: string;
  profileName?: string;
  hasTools: boolean;
  showThink?: boolean;
  debug?: boolean;
  /** 标准输出流，默认 process.stdout */
  stdout?: NodeJS.WriteStream;
  /** 标准错误流，默认 process.stderr */
  stderr?: NodeJS.WriteStream;
  /** 标准输入流，默认 process.stdin */
  stdin?: NodeJS.ReadStream;
}

export interface AgentEvent {
  agentName: string;
}

export type MessageLevel = 'status' | 'info' | 'warn' | 'error' | 'success';

export interface StatusEvent extends AgentEvent {
  message: string;
  level: MessageLevel;
}

export interface StreamEvent extends AgentEvent {
  text: string;
}

export interface ToolCallEvent extends AgentEvent {
  toolName: string;
  args: any;
}

export interface ToolResultEvent extends AgentEvent {
  status: ToolStatus;
  message?: string;
}

export interface ErrorEvent extends AgentEvent {
  message: string;
  stack?: string;
}

export interface DebugEvent extends AgentEvent {
  data: string;
}

export interface BackgroundTaskEvent extends AgentEvent {
  taskId: string;
  taskStatus: 'started' | 'completed' | 'error';
  message: string;
}

// ════════════════════════════════════════════
// StateSnapshot — agent 循环结束时的状态快照
// ════════════════════════════════════════════

export interface StateSnapshot {
  /** 当前 agent 名称 */
  agentName: string;
  /** 消息总数（含 system） */
  messageCount: number;
}

// ════════════════════════════════════════════
// DisplayPlugin — 展示层插件接口
// ════════════════════════════════════════════

export interface DisplayPlugin {
  name: string;

  /** 当前 display 插件是否独占全部终端输出。true = 核心禁止直接写 stdout */
  ownsOutput?: boolean;
  /** 当前 display 插件是否需要按键级原始输入 */
  rawInput?: boolean;

  /** display 插件初始化，可在此向 registry 注册 confirmCallback 等 */
  onInit?(registry: PluginRegistry): Promise<void>;

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

  onBackgroundTask?(event: BackgroundTaskEvent): void;

  /** agent 开始思考/处理任务时触发 */
  onAgentTurnStart?(event: AgentEvent): void;
  /** agent 完成一轮思考/任务时触发 */
  onAgentTurnEnd?(event: AgentEvent): void;

  /** 状态快照推送 */
  onStateSnapshot?(snapshot: StateSnapshot): void;

  /** 上下文分析可视化（Ink 展示层渲染色块） */
  onContextAnalysis?(analysis: ContextAnalysis): void;

  /**
   * 交互式插件管理器。
   * 显示可滚动的插件列表，支持启用/禁用切换。
   * 返回后由调用方决定是否要刷新插件列表等后续操作。
   * 如果 display 不支持交互式管理（REPL），可不实现此方法。
   */
  showPluginManager?(registry: PluginRegistry): Promise<boolean>;

  /**
   * 交互式模型选择器。
   * 显示模型列表，方向键选择 + Enter 切换。
   * 返回 true 表示已处理，false 表示不支持。
   */
  showModelPicker?(registry: PluginRegistry): Promise<boolean>;
}

// ════════════════════════════════════════════
// DisplayManager — 多展示层管理器
// ════════════════════════════════════════════

export class DisplayManager implements DisplayPlugin {
  readonly name = 'display-manager';
  private plugins: DisplayPlugin[] = [];

  addPlugin(plugin: DisplayPlugin): void {
    this.plugins.push(plugin);
  }

  async init(registry: PluginRegistry): Promise<void> {
    for (const p of this.plugins) {
      if (p.onInit) {
        try { await p.onInit(registry); }
        catch (err) { console.error(`[display] onInit failed for "${p.name}":`, err); }
      }
    }
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

  onUserInput(input: string, sourcePlugin: string): void {
    for (const p of this.plugins) p.onUserInput?.(input, sourcePlugin);
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

  onAgentTurnStart(event: AgentEvent): void {
    for (const p of this.plugins) p.onAgentTurnStart?.(event);
  }

  onBackgroundTask(event: BackgroundTaskEvent): void {
    for (const p of this.plugins) p.onBackgroundTask?.(event);
  }

  onAgentTurnEnd(event: AgentEvent): void {
    for (const p of this.plugins) p.onAgentTurnEnd?.(event);
  }

  onStateSnapshot(snapshot: StateSnapshot): void {
    for (const p of this.plugins) p.onStateSnapshot?.(snapshot);
  }

  onContextAnalysis(analysis: ContextAnalysis): void {
    for (const p of this.plugins) p.onContextAnalysis?.(analysis);
  }

  /**
   * 调用首个实现了 showPluginManager 的 display 插件打开交互式插件管理器。
   * 返回 true 表示已处理，false 表示无 display 支持。
   */
  async showPluginManager(registry: PluginRegistry): Promise<boolean> {
    for (const p of this.plugins) {
      if (p.showPluginManager) {
        await p.showPluginManager(registry);
        return true;
      }
    }
    return false;
  }

  /**
   * 调用首个实现了 showModelPicker 的 display 插件打开交互式模型选择器。
   * 返回 true 表示已处理，false 表示无 display 支持。
   */
  async showModelPicker(registry: PluginRegistry): Promise<boolean> {
    for (const p of this.plugins) {
      if (p.showModelPicker) {
        await p.showModelPicker(registry);
        return true;
      }
    }
    return false;
  }

  /** 返回 AgentDisplay 适配器，供 NanoCodeAgent 使用（代替完整的 DisplayPlugin） */
  asAgentDisplay(): AgentDisplay {
    return this;
  }
}