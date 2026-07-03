import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LLMResponse, ToolCall } from '#src/core/plugin.js';
import type { AgentDisplay, ToolStatus } from '#src/core/contract.js';
import type { ChatMessage } from '#src/core/llm.js';
import { sanitizeProjectPath } from '#src/plugins/tools/memory.js';

// ── StubLLMClient ──

/**
 * Sequence-aware stub that replaces LLMClient.
 * Returns predetermined responses in order on each call.
 */
export class StubLLMClient {
  callCount = 0;
  /** Messages arrays received by each call to sendSystemMessage */
  receivedMessages: ChatMessage[][] = [];

  constructor(private responses: LLMResponse[]) {}

  async sendSystemMessage(
    messages: ChatMessage[],
    _tools: any,
    onChunk?: (text: string) => void,
    _extraParams?: Record<string, unknown>,
    _onMeta?: (meta: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      (err as any).name = 'AbortError';
      throw err;
    }

    this.receivedMessages.push([...messages]);
    const idx = this.callCount++;
    const resp = this.responses[idx] ?? { text: 'e2e-fallback: no more stubbed responses', stopReason: 'stop' };
    if (resp.text && onChunk) onChunk(resp.text);
    return resp;
  }

  getModel(): string { return 'e2e-stub'; }
}

// ── SpyDisplay ──

export interface CapturedEvents {
  toolCalls: Array<{ toolName: string; args: any }>;
  toolResults: Array<{ status: ToolStatus; message?: string }>;
  snapshots: Array<{ messageCount: number }>;
  streamChunks: string[];
  statusMessages: Array<{ message: string; level: string }>;
  turnStarts: number;
  turnEnds: number;
}

export function createSpyDisplay(): { display: AgentDisplay; events: CapturedEvents } {
  const events: CapturedEvents = {
    toolCalls: [],
    toolResults: [],
    snapshots: [],
    streamChunks: [],
    statusMessages: [],
    turnStarts: 0,
    turnEnds: 0,
  };

  const display: AgentDisplay = {
    onToolCall: (e) => events.toolCalls.push({ toolName: e.toolName, args: e.args }),
    onToolResult: (e) => events.toolResults.push({ status: e.status, message: e.message }),
    onStateSnapshot: (e) => events.snapshots.push({ messageCount: e.messageCount }),
    onStreamChunk: (e) => events.streamChunks.push(e.text),
    onStatus: (e) => events.statusMessages.push({ message: e.message, level: e.level }),
    onAgentTurnStart: () => events.turnStarts++,
    onAgentTurnEnd: () => events.turnEnds++,
  };

  return { display, events };
}

// ── Tool call factory ──

export function createToolCall(
  name: string,
  args: Record<string, unknown>,
  id = 'e2e_call_1',
): ToolCall {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

// ── Temp directory ──

export function createTempDir(): { tmpDir: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-'));
  return {
    tmpDir,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/** Compute the sanitized memory project dir for cleanup */
export function getMemoryProjectDir(tmpDir: string): string {
  return path.join(os.homedir(), '.nano-code', 'projects', sanitizeProjectPath(tmpDir));
}
