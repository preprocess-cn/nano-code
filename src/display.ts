import { PluginRegistry } from '#src/core/plugin.js';
import type { ToolStatus, AgentDisplay, AgentEvent, DebugEvent, MessageLevel, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, StateSnapshot } from '#src/core/contract.js';
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

export interface BackgroundTaskEvent extends AgentEvent {
  taskId: string;
  taskStatus: 'started' | 'completed' | 'error';
  message: string;
}

/**
 * 通知事件 — 由 DisplayManager.setNotify 广播给 display 插件。
 * source 为消息来源标识（如插件名），message 为通知文本。
 * source 和 message 均为 null 时表示清除当前通知。
 */
export interface NotifyEvent {
  source: string;
  message: string;
}

// ── 共享事件类型（定义在 contract.ts） ──
export type { AgentEvent, DebugEvent, MessageLevel, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, StateSnapshot };

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
   * 状态栏内容更新（由 DisplayManager 合并后广播）。
   * segments 是当前所有 KEY 的完整映射，display 实现从中提取感兴趣的部分展示。
   * 每个 KEY 独立控制自己的展示区域 — 不存在会影响其他 KEY。
   */
  setStatusBar?(segments: Record<string, string>): void;

  /**
   * 可选的通知事件处理。
   * 由 DisplayManager.setNotify 广播，display 可在状态栏右侧展示。
   * @param notification - 通知对象，null 表示清除当前通知
   */
  onNotify?(notification: NotifyEvent | null): void;
}

// ════════════════════════════════════════════
// 展示层窄接口 — 插件只依赖所需的最小接口，而非完整的 DisplayManager
// ════════════════════════════════════════════

/** 展示输出接口 — 插件可安全调用的最小输出能力 */
export interface DisplayOutput {
  onStatus(event: StatusEvent): void;
  onError(event: ErrorEvent): void;
  onContextAnalysis?(analysis: ContextAnalysis): void;
}

/** 状态栏接口 — 每个 key 独立控制自己的 segment，互不影响 */
export interface DisplayStatusBar {
  /**
   * 设置状态栏段落。
   *
   * @param key   - 段落标识（如 "mode"、"tasks"、"tokens"）。
   *                每个 key 独立控制自己的显示区域，不会影响其他 key。
   * @param value - 展示文本：
   *                - `string | number` → 设置该段落的值为对应文本
   *                - `null` 或其他非 string/number 类型 → 清除该段落
   *                例：setStatusBar('tasks', '3 active') 设置 tasks 段
   *                    setStatusBar('mode', null)         清除 mode 段
   */
  setStatusBar(key: string, value: string | number | null): void;
}

/** 通知接口 */
export interface DisplayNotifier {
  setNotify(source: string | null, message: string | null): void;
}

/** 后台任务接口 */
export interface DisplayBackgroundTask {
  onBackgroundTask(event: BackgroundTaskEvent): void;
}

/** 交互式展示接口（模型选择/插件管理） */
export interface DisplayInteractive {
  showPluginManager(registry: PluginRegistry): Promise<boolean>;
  showModelPicker(registry: PluginRegistry): Promise<boolean>;
}

// ════════════════════════════════════════════
// DisplayManager — 多展示层管理器
// ════════════════════════════════════════════

export class DisplayManager implements DisplayOutput, DisplayStatusBar, DisplayNotifier, DisplayBackgroundTask, DisplayInteractive {
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
   * 设置状态栏段落 — 每个 KEY 独立控制自己的 segment。
   *
   * value 为 `string | number` 时设置该 KEY 的值；
   * value 为 `null` 或其他非 string/number 类型时清除该 KEY。
   *
   * 每次调用仅影响指定 KEY，其他 KEY 不受影响。
   * 合并完整 segments 映射后广播给所有 display 插件。
   *
   * @param key   - 段落标识，如 "mode"、"tasks"、"tokens"
   * @param value - string | number → 设值；null 或其他类型 → 清除
   */
  setStatusBar(key: string, value: string | number | null): void {
    if (typeof value === 'string' && value !== '') {
      this._statusBarSegments.set(key, value);
    } else if (typeof value === 'number') {
      this._statusBarSegments.set(key, String(value));
    } else {
      // null, undefined, object, boolean 等 → 清除该 KEY
      this._statusBarSegments.delete(key);
    }
    const merged: Record<string, string> = {};
    for (const [k, v] of this._statusBarSegments) merged[k] = v;
    for (const p of this.plugins) {
      try { p.setStatusBar?.(merged); }
      catch (err) { logManager.error('display', `setStatusBar failed for "${p.name}":`, err); }
    }
  }

  /**
   * 广播通知给所有 display 插件。
   * source 和 message 均为 null 时表示清除当前通知。
   */
  setNotify(source: string | null, message: string | null): void {
    const notification = source && message ? { source, message } : null;
    for (const p of this.plugins) {
      try { p.onNotify?.(notification); }
      catch (err) { logManager.error('display', `onNotify failed for "${p.name}":`, err); }
    }
  }

  /** 返回 AgentDisplay 适配器，供 NanoCodeAgent 使用（代替完整的 DisplayPlugin） */
  asAgentDisplay(): AgentDisplay {
    return this;
  }
}