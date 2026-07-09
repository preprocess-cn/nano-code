import { PluginRegistry } from '#src/core/plugin.js';
import type { ToolStatus, AgentDisplay, AgentEvent, MessageLevel, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, StateSnapshot } from '#src/core/contract.js';
import type { ContextAnalysis } from '#src/core/contract.js';
import { logManager } from '#src/utils/logger.js';

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

// ── 共享事件类型（定义在 contract.ts） ──
export type { AgentEvent, MessageLevel, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, StateSnapshot };

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

  /**
   * 可选的状态栏内容更新。
   * 传入各段落的键值映射（如 { tasks: "3 active", tokens: "85K/128K" }）。
   * 外部插件通过 DisplayManager.setStatusBar(key, value) 设置各自段落，
   * DisplayManager 合并后传入此方法。display 实现可选择展示方式。
   */
  setStatusBar?(segments: Record<string, string>): void;
}

// ════════════════════════════════════════════
// DisplayManager — 多展示层管理器
// ════════════════════════════════════════════

export class DisplayManager {
  readonly name = 'display-manager';
  private plugins: DisplayPlugin[] = [];

  addPlugin(plugin: DisplayPlugin): void {
    this.plugins.push(plugin);
  }

  async init(registry: PluginRegistry): Promise<void> {
    for (const p of this.plugins) {
      if (p.onInit) {
        try { await p.onInit(registry); }
        catch (err) { logManager.error('display', `onInit failed for "${p.name}":`, err); }
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

  private _statusBarSegments: Map<string, string> = new Map();

  /**
   * 设置状态栏段落。key 为段落标识（如 "tasks"），value 为展示文本，空串/null 表示移除。
   * 每次调用合并到内部状态后，将完整段落映射广播给所有 display 插件。
   */
  setStatusBar(key: string, value: string | null): void {
    if (value === null || value === '') {
      this._statusBarSegments.delete(key);
    } else {
      this._statusBarSegments.set(key, value);
    }
    const merged: Record<string, string> = {};
    for (const [k, v] of this._statusBarSegments) merged[k] = v;
    for (const p of this.plugins) {
      try { p.setStatusBar?.(merged); }
      catch (err) { logManager.error('display', `setStatusBar failed for "${p.name}":`, err); }
    }
  }

  /** 返回 AgentDisplay 适配器，供 NanoCodeAgent 使用（代替完整的 DisplayPlugin） */
  asAgentDisplay(): AgentDisplay {
    return this;
  }
}