import * as os from 'os';

function getEnvironmentSnapshot(): string {
  return [
    '\n\n[System Environment Snapshot]',
    `- Operating System: ${os.platform()} (${os.release()})`,
    `- Current Working Directory (CWD): ${process.cwd()}`,
    `- Shell Env: CI=true`,
  ].join('\n');
}

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

export interface ToolContext {
  skipPermission: boolean;
  cwd: string;
  defaultTimeout: number;
  /** Whether the current tool has side effects. false = no confirmation prompt needed. */
  sideEffect: boolean;
}

export function formatToolResponse(response: ToolResponse): string {
  if (response.status === 'rejected_by_user') {
    return JSON.stringify({
      status: 'rejected_by_user',
      message: [
        "CRITICAL ERROR: The human user has EXPLICITLY DENIED permission for this action.",
        "DO NOT attempt to retry this tool or any alternative tool execution in this turn.",
        "DO NOT generate any more tool calls.",
        "Your current operation pipeline must be HALTED immediately.",
        "Next Action Required:",
        "1. Politely acknowledge that the user cancelled the operation.",
        "2. Explain to the user why this specific operation was necessary for their request.",
        "3. Propose alternative, non-invasive or safer solutions (e.g., printing code to screen for manual copy, manual command advice) and wait for the user's feedback."
      ].join(' ') + getEnvironmentSnapshot()
    });
  }

  const enriched = { ...response };
  if (enriched.status !== 'success') {
    enriched.message = (enriched.message || '') + getEnvironmentSnapshot();
  }

  return JSON.stringify(enriched);
}
