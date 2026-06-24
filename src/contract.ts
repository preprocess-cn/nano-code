export type ToolStatus = 'success' | 'rejected_by_user' | 'error';

export interface ToolResponse {
  status: ToolStatus;
  data?: string;
  message?: string;
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

export type PermissionConfirmResponse = boolean;

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

export function isMainAgent(agentName: string): boolean {
  return agentName === 'main';
}

