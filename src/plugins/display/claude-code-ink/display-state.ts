import type { StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, AgentEvent, BackgroundTaskEvent } from '#src/display.js';
import type { ContextAnalysis } from '#src/core/contract.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';
import { type UIMessage, type TextSegment, type BackgroundTaskInfo } from '#src/plugins/display/claude-code-ink/InkApp.js';
import type { AgentTracker } from '#src/plugins/display/claude-code-ink/agent-tracker.js';
import { formatDuration, extractAgentType } from '#src/plugins/display/claude-code-ink/agent-tracker.js';
import { formatToolCall } from '#src/plugins/display/tool-display.js';
import type { PluginRegistry } from '#src/core/plugin.js';

/** 格式化为 HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 格式化为 YYYY-MM-DD */
function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * 解析 <think> 标签，返回文本段数组。
 * 处理残缺标签（单独的 </think> 或无闭标签）等边界情况。
 */
export function parseThinkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let remaining = text;
  let inThink = false;

  while (remaining.length > 0) {
    if (!inThink) {
      const closeIdx = remaining.indexOf('</think>');
      const openIdx = remaining.indexOf('<think>');
      if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        if (closeIdx > 0) segments.push({ text: remaining.slice(0, closeIdx), dim: true });
        remaining = remaining.slice(closeIdx + 8);
        continue;
      }
      if (openIdx === -1) {
        segments.push({ text: remaining, dim: false });
        break;
      }
      if (openIdx > 0) segments.push({ text: remaining.slice(0, openIdx), dim: false });
      remaining = remaining.slice(openIdx + 7);
      inThink = true;
    } else {
      const idx = remaining.indexOf('</think>');
      if (idx === -1) {
        segments.push({ text: remaining, dim: true });
        break;
      }
      if (idx > 0) segments.push({ text: remaining.slice(0, idx), dim: true });
      remaining = remaining.slice(idx + 8);
      inThink = false;
    }
  }

  return segments;
}

/** 获取或创建 per-agent 消息数组 */
function getOrCreate(map: Map<string, UIMessage[]>, name: string): UIMessage[] {
  let arr = map.get(name);
  if (!arr) { arr = []; map.set(name, arr); }
  return arr;
}

/**
 * 消息存储 + handler 事件处理。
 * 不持有 AgentTracker / ModalQueue 引用，通过方法参数传入。
 */
export class DisplayState {
  // ── Per-agent 消息存储 ──
  readonly agentMessages = new Map<string, UIMessage[]>();
  backgroundTasks: BackgroundTaskInfo[] = [];

  // ── 流式状态 ──
  streamAccumulator = '';
  visibleAccumulator = '';
  thinkStream: ThinkStream | null = null;
  lastStreamTarget: UIMessage | null = null;
  lastThinkTarget: UIMessage | null = null;
  thinkingStatusMsg: UIMessage | null = null;

  // ── 初始化状态 ──
  greeting = '';
  agentName = 'main';
  showThink = false;
  debug = false;
  greetingShown = false;
  sessionDateShown = '';

  // ── LLM 状态追踪 ──
  llmStatus: 'idle' | 'running' = 'idle';
  llmTurnStartTime = 0;
  llmLastTokenTime = 0;
  /** CC 风格：本轮流式字符累计长度，用于实时 token 估算 */
  responseLength = 0;

  // ── StatusBar 状态 ──
  statusSegments: Record<string, string> = {};
  notification: { source: string; message: string } | null = null;

  constructor() {
    this.agentMessages.set('main', []);
  }

  // ──────── 消息存储操作 ────────

  getOrCreate(agentName: string): UIMessage[] {
    return getOrCreate(this.agentMessages, agentName);
  }

  collectAgentNames(): Set<string> {
    return new Set(this.agentMessages.keys());
  }

  filteredMessages(currentViewAgent?: string): UIMessage[] {
    return currentViewAgent
      ? this.agentMessages.get(currentViewAgent) ?? []
      : this.agentMessages.get('main') ?? [];
  }

  clearAgentMessages(): void {
    for (const key of this.agentMessages.keys()) {
      if (key !== 'main') this.agentMessages.delete(key);
    }
  }

  resetAll(): void {
    this.agentMessages.clear();
    this.agentMessages.set('main', []);
    this.backgroundTasks = [];
    this.streamAccumulator = '';
    this.visibleAccumulator = '';
    this.thinkStream = null;
    this.lastStreamTarget = null;
    this.lastThinkTarget = null;
    this.thinkingStatusMsg = null;
    this.llmStatus = 'idle';
    this.llmTurnStartTime = 0;
    this.llmLastTokenTime = 0;
    this.responseLength = 0;
    this.greetingShown = false;
    this.sessionDateShown = '';
    this.statusSegments = {};
    this.notification = null;
  }

  /** 重置流式状态（工具调用前） */
  resetStream(): void {
    this.streamAccumulator = '';
    this.visibleAccumulator = '';
    this.thinkStream = null;
    this.lastStreamTarget = null;
    this.lastThinkTarget = null;
    this.thinkingStatusMsg = null;
  }

  // ──────── Handler 逻辑 ────────

  addUserInput(agentName: string, input: string): void {
    const target = this.getOrCreate(agentName);
    target.push({ agentName, text: input, kind: 'userInput' });
  }

  handleStatus(event: StatusEvent, tracker: AgentTracker): void {
    if (event.level === 'status') {
      if (event.message === 'thinking') {
        if (this.showThink) {
          const msg: UIMessage = { agentName: event.agentName, text: '? 正在思考并请求大模型...', kind: 'thinking' };
          this.getOrCreate(event.agentName).push(msg);
          this.thinkingStatusMsg = msg;
        }
      }
      return;
    }
    if (!event.message) return;
    const kind: UIMessage['kind'] = event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' : event.level === 'success' ? 'success' : event.level === 'info' ? 'info' : 'status';
    if (event.agentName !== 'main') {
      const target = this.getOrCreate(event.agentName);
      if (tracker.states.has(event.agentName)) {
        // 被追踪的子 agent：仅清除流式/工具调用消息
        this.agentMessages.set(event.agentName, target.filter(m =>
          !(m.kind === 'stream' || m.kind === 'thinking' || m.kind === 'toolCall')));
      } else if (event.level === 'success' || event.level === 'warn' || event.level === 'error') {
        // 未追踪的 agent：清除所有
        this.agentMessages.delete(event.agentName);
        this.getOrCreate(event.agentName).push({ agentName: event.agentName, text: event.message, kind });
        return;
      }
      target.push({ agentName: event.agentName, text: event.message, kind });
    } else {
      this.getOrCreate('main').push({ agentName: event.agentName, text: event.message, kind });
    }
  }

  /** onStreamChunk 核心逻辑（think 标签解析 + 消息累加） */
  handleStreamChunk(event: StreamEvent): boolean {
    if (!event.text) return false;
    const target = this.getOrCreate(event.agentName);

    if (this.showThink) {
      this.streamAccumulator += event.text;
      const segments = parseThinkSegments(this.streamAccumulator);

      let thinkText = '';
      let normalText = '';
      for (const seg of segments) {
        if (seg.dim) thinkText += seg.text;
        else normalText += seg.text;
      }
      normalText = normalText.replace(/^\n+/, '');

      let anyUpdate = false;

      if (thinkText) {
        if (this.thinkingStatusMsg) {
          this.thinkingStatusMsg.text = thinkText;
          this.lastThinkTarget = this.thinkingStatusMsg;
          this.thinkingStatusMsg = null;
        } else if (this.lastThinkTarget?.kind === 'thinking' && this.lastThinkTarget.agentName === event.agentName) {
          this.lastThinkTarget.text = thinkText;
        } else {
          const msg: UIMessage = { agentName: event.agentName, text: thinkText, kind: 'thinking' };
          target.push(msg);
          this.lastThinkTarget = msg;
        }
        anyUpdate = true;
      }

      if (this.lastStreamTarget?.kind === 'stream' && this.lastStreamTarget.agentName === event.agentName) {
        if (normalText !== this.lastStreamTarget.text) {
          this.lastStreamTarget.text = normalText;
          anyUpdate = true;
        }
      } else if (normalText) {
        const msg: UIMessage = { agentName: event.agentName, text: normalText, kind: 'stream' };
        target.push(msg);
        this.lastStreamTarget = msg;
        anyUpdate = true;
      }

      if (!anyUpdate) return false;
    } else {
      if (!this.thinkStream) this.thinkStream = new ThinkStream();
      const filtered = this.thinkStream.next(event.text);
      if (!filtered) return false;
      const cleaned = !this.visibleAccumulator ? filtered.replace(/^\n+/, '') : filtered;
      if (!cleaned) return false;
      this.visibleAccumulator += cleaned;
      const visible = this.visibleAccumulator;

      const last = target[target.length - 1];
      const sameStream = last?.agentName === event.agentName && last.kind === 'stream';
      if (sameStream && this.lastStreamTarget === last) {
        last.text = visible;
      } else {
        target.push({ agentName: event.agentName, text: visible, kind: 'stream' });
        this.lastStreamTarget = target[target.length - 1];
      }
    }
    this.llmLastTokenTime = Date.now();
    return true;
  }

  addToolCall(event: ToolCallEvent, registry?: PluginRegistry): void {
    const raw = formatToolCall(event.toolName, event.args, registry?.getAllSchemas());
    const text = raw.replace(/^🔧\s*/, '');
    this.getOrCreate(event.agentName).push({
      agentName: event.agentName,
      text,
      kind: 'toolCall',
      toolStatus: 'running',
    });
    this.llmLastTokenTime = Date.now();
  }

  handleToolResult(event: ToolResultEvent): void {
    const target = this.getOrCreate(event.agentName);
    for (let i = target.length - 1; i >= 0; i--) {
      const m = target[i];
      if (m.kind === 'toolCall' && m.toolStatus === 'running') {
        if (event.status === 'error') {
          m.toolStatus = 'error';
          if (event.message) target.push({ agentName: event.agentName, text: `✗ ${event.message}`, kind: 'error' });
        } else if (event.status === 'rejected_by_user') {
          m.toolStatus = 'error';
          target.push({ agentName: event.agentName, text: '⛔ 已拦截', kind: 'error' });
        } else {
          m.toolStatus = 'success';
        }
        return;
      }
    }
    const fallbackText = event.status === 'success' ? '✓ 完成'
      : event.status === 'error' ? `✗ ${event.message || '失败'}`
      : '⛔ 已拦截';
    target.push({ agentName: event.agentName, text: fallbackText, kind: 'toolResult' });
  }

  handleError(event: ErrorEvent): void {
    this.getOrCreate(event.agentName).push({ agentName: event.agentName, text: event.message, kind: 'error' });
  }

  handleDebug(event: DebugEvent): void {
    if (!this.debug) return;
    this.getOrCreate(event.agentName).push({ agentName: event.agentName, text: `[DEBUG] ${event.data}`, kind: 'status' });
  }

  /** Agent 启动：双写 agent transcript + 主视图摘要 */
  handleAgentTurnStart(event: AgentEvent, tracker: AgentTracker): void {
    const type = event.agentName === 'main' ? 'main' : extractAgentType(event.agentName);
    if (event.agentName === 'main') {
      // 主 agent — 管理 LLM 状态栏
      if (this.llmStatus === 'running') return;
      this.llmStatus = 'running';
      this.llmTurnStartTime = Date.now();
      this.llmLastTokenTime = Date.now();
      this.responseLength = 0;
      return;
    }

    // 子 agent：由 tracker.startAgent 设置状态/颜色/token
    tracker.startAgent(event.agentName, event.query, event.description);

    // 写入 agent 自身 transcript
    const querySnippet = event.query ? event.query.slice(0, 60).replace(/\n/g, ' ') : '';
    this.getOrCreate(event.agentName).push({
      agentName: event.agentName,
      text: `${type} 开始 · ${querySnippet || event.description || ''}`,
      kind: 'info',
    });
    // 写入主视图摘要
    const summary: UIMessage = {
      agentName: 'main',
      text: `  ├─ ${type}${querySnippet ? ` · ${querySnippet}` : ''} · 搜索中...`,
      kind: 'info',
    };
    this.getOrCreate('main').push(summary);
    tracker.setStartMessage(event.agentName, summary);
  }

  /** Agent 结束：双写 turnComplete 到 agent transcript + 主视图 */
  handleAgentTurnEnd(event: AgentEvent, tracker: AgentTracker, registry?: PluginRegistry): void {
    const now = Date.now();
    if (event.agentName !== 'main') {
      const result = tracker.endAgent(event.agentName, registry);
      if (!result) return; // 防止重复处理
      const elapsedMs = result.elapsedMs;
      const duration = formatDuration(elapsedMs);
      const today = formatDate(now);
      let ts: string;
      if (this.sessionDateShown !== today) {
        this.sessionDateShown = today;
        ts = `${today} ${formatTime(now)}`;
      } else {
        ts = formatTime(now);
      }
      this.getOrCreate(event.agentName).push({
        agentName: event.agentName,
        text: `完成 · ${duration} · ${ts}`,
        kind: 'turnComplete',
      });
      return;
    }

    // 主 agent
    if (this.llmStatus !== 'running') return;
    this.llmStatus = 'idle';
    const elapsedMs = now - this.llmTurnStartTime;
    const today = formatDate(now);
    let ts: string;
    if (this.sessionDateShown !== today) {
      this.sessionDateShown = today;
      ts = `${today} ${formatTime(now)}`;
    } else {
      ts = formatTime(now);
    }
    const duration = formatDuration(elapsedMs);
    this.getOrCreate('main').push({
      agentName: event.agentName,
      text: `完成 · ${duration} · ${ts}`,
      kind: 'turnComplete',
    });
  }

  handleBackgroundTask(event: BackgroundTaskEvent): void {
    const existing = this.backgroundTasks.findIndex(t => t.taskId === event.taskId);
    const bgStatus: BackgroundTaskInfo['status'] = event.taskStatus === 'started' ? 'running' : event.taskStatus;
    const info: BackgroundTaskInfo = { taskId: event.taskId, agentName: event.agentName, status: bgStatus, message: event.message };
    if (existing >= 0) {
      this.backgroundTasks[existing] = info;
    } else {
      this.backgroundTasks.push(info);
    }
  }

  addContextAnalysis(analysis: ContextAnalysis): void {
    this.getOrCreate('main').push({ agentName: 'main', text: '', kind: 'status', contextAnalysis: analysis });
  }

  addModelSwitchMessage(label: string): void {
    this.getOrCreate('main').push({ agentName: 'main', text: `已切换到模型: ${label}`, kind: 'status' });
  }

  setStatusBar(segments: Record<string, string>, mode?: string): void {
    this.statusSegments = { ...segments };
    if (mode === 'plan' || mode === 'normal') {
      this.statusSegments.mode = mode;
    } else {
      delete this.statusSegments.mode;
    }
  }

  setNotification(n: { source: string; message: string } | null): void {
    this.notification = n;
  }

  /** CC 风格：流式响应字符累计 */
  addResponseDelta(delta: string): void {
    if (delta) this.responseLength += delta.length;
  }

  /** CC 风格：字符长度 / 4 实时估算本轮 token */
  getEstimatedTurnTokens(): number {
    return Math.round(this.responseLength / 4);
  }
}
