import { getAgentColor, type AgentRuntimeState, type UIMessage } from '#src/plugins/display/claude-code-ink/InkApp.js';
import { formatDuration } from '#src/utils/format.js';

/** 从 agentName 中提取类型名（'explore_sync_abc123' → 'explore'） */
export function extractAgentType(agentName: string): string {
  if (agentName === 'main') return 'main';
  const syncIdx = agentName.indexOf('_sync_');
  if (syncIdx !== -1) return agentName.slice(0, syncIdx);
  const bgIdx = agentName.indexOf('_bg_');
  if (bgIdx !== -1) return agentName.slice(0, bgIdx);
  return agentName;
}

/**
 * Agent 运行时追踪。
 * 不拥有消息数据，仅持有对消息对象的引用用于进度更新。
 */
export class AgentTracker {
  readonly states = new Map<string, AgentRuntimeState>();
  readonly colors: Record<string, string> = {};
  /** 主视图中 agent 摘要消息的引用（用于 mutable text update） */
  readonly startMessages = new Map<string, UIMessage>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderFn: (() => void) | null = null;

  setRenderFn(fn: () => void): void {
    this.renderFn = fn;
  }

  /** agent 启动：设置状态、颜色、启动计时器 */
  startAgent(agentName: string, query?: string, description?: string): void {
    const type = extractAgentType(agentName);
    if (!this.colors[agentName]) {
      this.colors[agentName] = getAgentColor(type);
    }
    const querySnippet = query ? query.slice(0, 60).replace(/\n/g, ' ') : '';
    this.states.set(agentName, {
      type,
      fullName: agentName,
      status: 'running',
      startTime: Date.now(),
      toolUseCount: 0,
      tokens: 0,
      query: querySnippet,
      description,
    });
    this.startTimer();
  }

  /** 记录主视图中摘要消息的引用 */
  setStartMessage(agentName: string, msg: UIMessage): void {
    this.startMessages.set(agentName, msg);
  }

  /** 工具调用时更新计数 + token + 主视图进度 */
  updateToolCall(agentName: string, toolName: string, tokens?: number): void {
    const state = this.states.get(agentName);
    if (!state) return;
    state.toolUseCount++;
    state.lastToolName = toolName;
    if (tokens !== undefined) state.tokens = tokens;
    const startMsg = this.startMessages.get(agentName);
    if (startMsg) {
      const elapsed = formatDuration(Date.now() - state.startTime);
      startMsg.text = `  ├─ ${state.type} · ${state.toolUseCount}工具 · ${elapsed}`;
    }
  }

  /** agent 结束：更新状态、token、主视图摘要、停止计时器 */
  endAgent(agentName: string, tokens?: number): { state: AgentRuntimeState; elapsedMs: number } | null {
    const state = this.states.get(agentName);
    if (!state || state.status !== 'running') return null;
    state.status = 'completed';
    state.endTime = Date.now();
    if (tokens !== undefined) state.tokens = tokens;
    const startMsg = this.startMessages.get(agentName);
    if (startMsg) {
      const elapsed = formatDuration(state.endTime - state.startTime);
      startMsg.text = `  └─ ${state.type} · 完成 · ${state.toolUseCount}工具 · ${elapsed}`;
      this.startMessages.delete(agentName);
    }
    if (!this.hasRunning()) this.stopTimer();
    return { state, elapsedMs: state.endTime - state.startTime };
  }

  /** 刷新所有运行中 agent 的进度文本 */
  updateProgress(): void {
    const now = Date.now();
    for (const [name, state] of this.states) {
      if (state.status !== 'running') continue;
      const startMsg = this.startMessages.get(name);
      if (!startMsg) continue;
      startMsg.text = `  ├─ ${state.type} · ${state.toolUseCount}工具 · ${formatDuration(now - state.startTime)}`;
    }
  }

  hasRunning(): boolean {
    for (const s of this.states.values()) {
      if (s.status === 'running') return true;
    }
    return false;
  }

  startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.updateProgress();
      this.renderFn?.();
    }, 1000);
  }

  stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  clearAll(): void {
    this.stopTimer();
    this.states.clear();
    this.startMessages.clear();
    for (const key of Object.keys(this.colors)) delete this.colors[key];
  }
}
