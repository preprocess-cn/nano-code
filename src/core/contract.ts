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
 *
 * contextModifier: 保留字段，用于未来 ToolUseContext 设计。
 *   工具可返回修改器改变后续工具调用的执行环境
 *   （如限制可用工具集、覆盖模型、调整 effort 级别）。
 */
export interface ToolResponse {
  status: ToolStatus;
  data?: string;
  message?: string;
  /** 额外消息注入主循环（inline skill 展开用） */
  newMessages?: InjectedMessage[];
  /** 保留：执行上下文修改器（用于未来 ToolUseContext） */
  contextModifier?: unknown;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    /** Whether this tool changes external state. false = read-only, auto-execute without user confirmation. */
    sideEffect?: boolean;
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

