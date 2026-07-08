export type ToolStatus = 'success' | 'rejected_by_user' | 'error';

/**
 * 工具注入到主循环的额外消息。
 * 用于 inline skill 展开：skill 的内容以 user 消息形式注入消息历史，
 * LLM 在下一轮循环中看到这些消息继续推理。
 */
export interface InjectedMessage {
  role?: 'user' | 'assistant';
  content: string;
}

/**
 * 工具响应。
 *
 * newMessages: inline skill 展开时注入主循环的消息。
 *   主 agent 的 executeToolCall 检测到此字段后，
 *   将消息追加到 messageHistory 中。
 */
export interface ToolResponse {
  status: ToolStatus;
  data?: string;
  message?: string;
  /** 额外消息注入主循环（inline skill 展开用） */
  newMessages?: InjectedMessage[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    /** Whether this tool changes external state. false = read-only, auto-execute without user confirmation. */
    sideEffect?: boolean;
    /** User-friendly display name (e.g., "Bash" for "run_bash_command"). When set, display plugins show this instead of the raw tool name. */
    displayName?: string;
  };
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface PermissionConfirmRequest {
  toolName: string;
  /** User-friendly tool name for permission dialog display. Falls back to toolName when not set. */
  displayName?: string;
  message: string;
  details?: string;
  /** Diff hunks for file edit/write operations. When set, display plugins should render a diff view. */
  diff?: DiffHunk[];
  /** Target file path (needed for syntax highlighting in diff view). */
  filePath?: string;
}

export type PermissionConfirmResponse = boolean | 'always_allow';

/** Display-layer output handler for command stdout/stderr streaming. */
export interface CommandOutputHandler {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
}

export interface ToolContext {
  skipPermission: boolean;
  cwd: string;
  defaultTimeout: number;
  /** Whether the current tool has side effects. false = no confirmation prompt needed. */
  sideEffect: boolean;
  /** Injected by display plugin. When set, tool plugins use this instead of direct @clack/prompts. */
  confirmCallback?: (req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>;
  /** Injected by display plugin. When set, tool plugins stream output here instead of process.stdout. */
  outputHandler?: CommandOutputHandler;
}

/**
 * 插件 onBeforeAgentInput 钩子的返回值。
 * handled: true 表示插件已处理该输入。
 * exit: 退出进程。skipAgent: 跳过 agent.runTask。
 * injectMessages: 注入到 agent 历史的消息。
 * replaceInput: 替换发送给 agent 的用户输入（不设置时使用原始输入）。
 * message: 要显示的状态消息。
 */
export interface CommandInterceptResult {
  handled: true;
  exit?: boolean;
  skipAgent?: boolean;
  injectMessages?: InjectedMessage[];
  replaceInput?: string;
  message?: string;
}

export function isMainAgent(agentName: string): boolean {
  return agentName === 'main';
}

/**
 * Agent 对展示层的窄接口。
 * NanoCodeAgent 只依赖这个子集接口，不依赖完整的 DisplayPlugin。
 * 展示层通过 DisplayManager.asAgentDisplay() 适配。
 */
/**
 * onAgentReady hook 上下文。
 * NanoCodeAgent 创建后触发，供插件获取 agent/display 引用。
 */
export interface AgentReadyContext {
  agent: import('#src/core/agent.js').NanoCodeAgent;
  display: import('#src/display.js').DisplayManager;
}

/**
 * onSessionRestore hook 上下文。
 * --continue 恢复会话时触发，供插件（如 token-budget）恢复状态。
 */
export interface SessionRestoreContext {
  messages: import('#src/core/llm.js').ChatMessage[];
  store: import('#src/core/store.js').IStore;
}

/**
 * onAgentExit hook 上下文。
 * Agent 退出时触发（runTask 结束），插件可在此清理该 agent 衍生的资源（如 monitor 进程）。
 */
export interface AgentExitContext {
  /** 退出的 agent 名称 */
  agentName: string;
}

export interface AgentDisplay {
  onStatus?(event: { message: string; agentName: string; level: string }): void;
  onStreamChunk?(event: { text: string; agentName: string }): void;
  onToolCall?(event: { id?: string; toolName: string; args: any; agentName: string }): void;
  onToolResult?(event: { id?: string; status: ToolStatus; message?: string; agentName: string }): void;
  onStateSnapshot?(snapshot: { agentName: string; messageCount: number }): void;
  onAgentTurnStart?(event: { agentName: string }): void;
  onAgentTurnEnd?(event: { agentName: string }): void;
}

