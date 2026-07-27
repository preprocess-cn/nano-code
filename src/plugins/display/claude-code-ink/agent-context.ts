import type { IStore } from '#src/core/store.js';
import type { UIMessage } from '#src/plugins/display/claude-code-ink/InkApp.js';

/**
 * 对标 CC ToolUseContext 的轻量版 per-agent 隔离上下文。
 * 只包含 display 层需要的字段，不涉及 CC 的完整 tool 系统。
 */
export interface AgentContext {
  /** agent 名称（与 UIMessage.agentName 对应，如 'main'、'explore_sync_abc123'） */
  agentName: string;
  /** agent 类型：'main' | 'Explore' | 'Plan' | ... */
  agentType: string;
  /** 父 agent 上下文（子 agent 通过 createSubagentContext 创建时设置） */
  parentContext?: AgentContext;

  /** 当前 agent 的消息列表（display 层渲染用，可变） */
  messages: UIMessage[];

  /** 流式文本管理器：函数式 updater（对标 CC onStreamingText） */
  streamingText: StreamingTextManager;

  /** 贡献 response length 到父 agent 的计数器（子 agent 默认共享父的回调） */
  setResponseLength: (f: (prev: number) => number) => void;

  /** 取消控制器 */
  abortController: AbortController;

  /** 共享 store（由 PluginRegistry 管理，所有 agent 共享同一实例） */
  store: IStore;

  /** 是否为异步 agent（后台运行，不显示交互 UI） */
  isAsync: boolean;
}

/**
 * 流式文本管理器。对标 CC 的 onStreamingText 函数式 updater 模式：
 * - 读取当前值：manager.get() → string | null
 * - 累加文本：manager.update(prev => (prev ?? '') + delta)
 * - 清除：manager.update(() => null) 或 manager.reset()
 *
 * null 表示当前没有活跃的流式文本。
 */
export class StreamingTextManager {
  private value: string | null = null;

  get(): string | null {
    return this.value;
  }

  update(f: (prev: string | null) => string | null): void {
    this.value = f(this.value);
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * 创建子 agent 的隔离上下文。对标 CC createSubagentContext。
 *
 * 隔离的字段（子 agent 独立）：
 *   - agentName, agentType, messages, streamingText, abortController
 *
 * 共享的字段（沿用父 agent）：
 *   - setResponseLength（token 消耗贡献到父 agent）
 *   - store（插件状态存储）
 */
export function createSubagentContext(
  parent: AgentContext,
  overrides: {
    agentName: string;
    agentType: string;
    isAsync?: boolean;
    abortController?: AbortController;
    messages?: UIMessage[];
  },
): AgentContext {
  return {
    agentName: overrides.agentName,
    agentType: overrides.agentType,
    parentContext: parent,

    // 隔离
    messages: overrides.messages ?? [],
    streamingText: new StreamingTextManager(),
    abortController: overrides.abortController ?? new AbortController(),

    // 共享
    setResponseLength: parent.setResponseLength,
    store: parent.store,

    isAsync: overrides.isAsync ?? true,
  };
}

/**
 * 创建主 agent 的根上下文。
 * setResponseLength 初始为空操作，由 DisplayState 在初始化时注入实际回调。
 */
export function createMainContext(store: IStore): AgentContext {
  return {
    agentName: 'main',
    agentType: 'main',
    messages: [],
    streamingText: new StreamingTextManager(),
    setResponseLength: (_f: (prev: number) => number) => {
      // 占位回调，由 DisplayState 在构造后注入
    },
    abortController: new AbortController(),
    store,
    isAsync: false,
  };
}
