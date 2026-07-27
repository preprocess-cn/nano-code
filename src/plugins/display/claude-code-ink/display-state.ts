import type { StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, AgentEvent, BackgroundTaskEvent } from '#src/display.js';
import type { ContextAnalysis } from '#src/core/contract.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';
import { type UIMessage, type BackgroundTaskInfo } from '#src/plugins/display/claude-code-ink/InkApp.js';
import type { AgentTracker } from '#src/plugins/display/claude-code-ink/agent-tracker.js';
import { formatDuration } from '#src/utils/format.js';
import { extractAgentType } from '#src/plugins/display/claude-code-ink/agent-tracker.js';
import { formatToolCall } from '#src/plugins/display/tool-display.js';
import type { PluginRegistry } from '#src/core/plugin.js';
import { tokenBudgetKey } from '#src/store-keys.js';
import { debugLog } from '#src/plugins/display/claude-code-ink/utils/debugLog.js';
import {
  type AgentContext,
  createMainContext,
  createSubagentContext,
} from '#src/plugins/display/claude-code-ink/agent-context.js';
import { handleStreamDelta, clearStreamingText } from '#src/plugins/display/claude-code-ink/handle-message.js';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

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
export function parseThinkSegments(text: string): { text: string; dim: boolean }[] {
  const segments: { text: string; dim: boolean }[] = [];
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

/**
 * 消息存储 + handler 事件处理。
 * 使用 AgentContext 实现 per-agent 隔离，对标 CC 的 ToolUseContext 架构。
 */
export class DisplayState {
  // ── Agent Contexts ──
  private mainCtx: AgentContext;
  private agentContexts = new Map<string, AgentContext>();

  // ── Per-agent ThinkStream ──
  private thinkStreams = new Map<string, ThinkStream>();

  // ── LLM 状态追踪 ──
  llmStatus: 'idle' | 'running' = 'idle';
  llmTurnStartTime = 0;
  llmLastTokenTime = 0;

  // ── 每个 agent 的 responseLength（字符数，用于 token 估算）──
  responseLength = new Map<string, number>();

  // ── 流式文本（showThink 模式下的原始累积，用于 parseThinkSegments）──
  private streamAccum = new Map<string, string>();

  // ── showThink 模式下的 lastStreamTarget / lastThinkTarget ──
  private lastStreamTarget: UIMessage | null = null;
  private lastThinkTarget: UIMessage | null = null;
  private thinkingStatusMsg: UIMessage | null = null;

  // ── showThink 模式下每个 agent 上次 normal text 长度（用于 delta 计算）──
  private lastNormalLen = new Map<string, number>();

  // ── 初始化状态 ──
  greeting = '';
  agentName = 'main';
  showThink = false;
  debug = false;
  greetingShown = false;
  sessionDateShown = '';

  // ── StatusBar ──
  statusSegments: Record<string, string> = {};
  notification: { source: string; message: string } | null = null;

  // ── 后台任务 ──
  backgroundTasks: BackgroundTaskInfo[] = [];

  constructor() {
    // store 占位：onInit 时由 PluginRegistry 注入
    const placeholderStore = {
      get: () => undefined,
      set: () => {},
      subscribe: () => () => {},
    } as any;
    this.mainCtx = createMainContext(placeholderStore);
    this.agentContexts.set('main', this.mainCtx);
    // 注入真正的 setResponseLength
    this.mainCtx.setResponseLength = (f) => {
      const prev = this.responseLength.get('main') ?? 0;
      this.responseLength.set('main', f(prev));
    };
  }

  /** 初始化 store（onInit 时由 index.ts 调用） */
  initStore(store: any): void {
    this.mainCtx.store = store;
    for (const ctx of this.agentContexts.values()) {
      ctx.store = store;
    }
  }

  // ──────── Agent Context 管理 ────────

  /** 获取或创建 agent context */
  private getContext(agentName: string): AgentContext {
    if (agentName === 'main') return this.mainCtx;
    let ctx = this.agentContexts.get(agentName);
    if (!ctx) {
      ctx = createSubagentContext(this.mainCtx, {
        agentName,
        agentType: extractAgentType(agentName),
      });
      this.agentContexts.set(agentName, ctx);
    }
    return ctx;
  }

  /** 获取 agent 的 ThinkStream */
  private getThinkStream(agentName: string): ThinkStream {
    let ts = this.thinkStreams.get(agentName);
    if (!ts) {
      ts = new ThinkStream();
      this.thinkStreams.set(agentName, ts);
      debugLog(`newThinkStream agent=${agentName}`);
    }
    return ts;
  }

  // ──────── 消息操作 ────────

  collectAgentNames(): Set<string> {
    return new Set(this.agentContexts.keys());
  }

  filteredMessages(currentViewAgent?: string): UIMessage[] {
    if (currentViewAgent) {
      return this.getContext(currentViewAgent).messages;
    }
    return this.mainCtx.messages;
  }

  clearAgentMessages(): void {
    for (const key of this.agentContexts.keys()) {
      if (key !== 'main') {
        this.agentContexts.delete(key);
        this.thinkStreams.delete(key);
      }
    }
  }

  /** 获取 agent 的消息列表（兼容旧 API） */
  getAgentMessages(agentName: string): UIMessage[] {
    return this.getContext(agentName).messages;
  }

  resetAll(): void {
    this.agentContexts.clear();
    this.agentContexts.set('main', this.mainCtx);
    this.mainCtx.messages = [];
    this.thinkStreams.clear();
    this.streamAccum.clear();
    this.responseLength.clear();
    this.lastNormalLen.clear();
    this.lastStreamTarget = null;
    this.lastThinkTarget = null;
    this.thinkingStatusMsg = null;
    this.llmStatus = 'idle';
    this.llmTurnStartTime = 0;
    this.llmLastTokenTime = 0;
    this.greetingShown = false;
    this.sessionDateShown = '';
    this.statusSegments = {};
    this.notification = null;
    this.backgroundTasks = [];
  }

  /** 清除所有 agent 的流式状态（对标 CC content_block_start → clear） */
  resetStream(): void {
    for (const ctx of this.agentContexts.values()) {
      clearStreamingText(ctx);
    }
    this.streamAccum.clear();
    this.thinkStreams.clear();
    this.lastStreamTarget = null;
    this.lastThinkTarget = null;
    this.thinkingStatusMsg = null;
    this.lastNormalLen.clear();
  }

  // ──────── Handler 逻辑 ────────

  addUserInput(agentName: string, input: string): void {
    const ctx = this.getContext(agentName);
    ctx.messages.push({ agentName, text: input, kind: 'userInput' });
  }

  handleStatus(event: StatusEvent, tracker: AgentTracker): void {
    if (event.level === 'status') {
      if (event.message === 'thinking') {
        if (this.showThink) {
          const ctx = this.getContext(event.agentName);
          const msg: UIMessage = { agentName: event.agentName, text: '? 正在思考并请求大模型...', kind: 'thinking' };
          ctx.messages.push(msg);
          this.thinkingStatusMsg = msg;
        }
      }
      return;
    }
    if (!event.message) return;
    const kind: UIMessage['kind'] =
      event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' :
      event.level === 'success' ? 'success' : event.level === 'info' ? 'info' : 'status';
    if (event.agentName !== 'main') {
      const ctx = this.getContext(event.agentName);
      if (tracker.states.has(event.agentName)) {
        ctx.messages = ctx.messages.filter(m =>
          !(m.kind === 'stream' || m.kind === 'thinking' || m.kind === 'toolCall'));
      } else if (event.level === 'success' || event.level === 'warn' || event.level === 'error') {
        // 未追踪的 agent：清除旧消息
        ctx.messages = [{ agentName: event.agentName, text: event.message, kind }];
        return;
      }
      ctx.messages.push({ agentName: event.agentName, text: event.message, kind });
    } else {
      this.mainCtx.messages.push({ agentName: event.agentName, text: event.message, kind });
    }
  }

  handleStreamChunk(event: StreamEvent): boolean {
    if (!event.text) return false;
    const ctx = this.getContext(event.agentName);
    const ts = this.getThinkStream(event.agentName);

    debugLog(`hsc:enter agent=${event.agentName} rawLen=${event.text.length} showThink=${this.showThink}`);

    if (this.showThink) {
      // showThink 模式：使用 parseThinkSegments 解析完整流
      const rawAcc = (this.streamAccum.get(event.agentName) ?? '') + event.text;
      this.streamAccum.set(event.agentName, rawAcc);
      const segments = parseThinkSegments(rawAcc);

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
          ctx.messages.push(msg);
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
        ctx.messages.push(msg);
        this.lastStreamTarget = msg;
        anyUpdate = true;
      }

      if (anyUpdate) {
        const prevLen = this.lastNormalLen.get(event.agentName) ?? 0;
        const delta = normalText.length - prevLen;
        if (delta > 0) {
          this.addResponseDelta(event.agentName, delta);
          this.lastNormalLen.set(event.agentName, normalText.length);
        }
      } else {
        debugLog(`hsc:exit showThink noUpdate agent=${event.agentName}`);
        return false;
      }
    } else {
      // 默认模式：使用 ThinkStream 过滤 + handleStreamDelta
      const deltaType = event.deltaType ?? 'text_delta';
      const result = handleStreamDelta(
        { agentName: event.agentName, type: deltaType, text: event.text },
        ctx,
        ts,
        false,
      );

      if (!result) {
        return false;
      }
      ctx.messages = result;

      // 更新 responseLength
      const currentStreaming = ctx.streamingText.get();
      if (currentStreaming) {
        this.responseLength.set(event.agentName, currentStreaming.length);
      }
      debugLog(`hsc:exitOk agent=${event.agentName} streamingLen=${currentStreaming?.length ?? 0} responseLen=${this.responseLength.get(event.agentName)}`);
    }
    this.llmLastTokenTime = Date.now();
    return true;
  }

  addToolCall(event: ToolCallEvent, registry?: PluginRegistry): void {
    const ctx = this.getContext(event.agentName);
    const raw = formatToolCall(event.toolName, event.args, registry?.getAllSchemas());
    const text = raw.replace(/^🔧\s*/, '');
    ctx.messages.push({
      agentName: event.agentName,
      text,
      kind: 'toolCall',
      toolStatus: 'running',
    });
    this.llmLastTokenTime = Date.now();
  }

  handleToolResult(event: ToolResultEvent): void {
    const ctx = this.getContext(event.agentName);
    for (let i = ctx.messages.length - 1; i >= 0; i--) {
      const m = ctx.messages[i];
      if (m.kind === 'toolCall' && m.toolStatus === 'running') {
        if (event.status === 'error') {
          m.toolStatus = 'error';
          if (event.message) ctx.messages.push({ agentName: event.agentName, text: `✗ ${event.message}`, kind: 'error' });
        } else if (event.status === 'rejected_by_user') {
          m.toolStatus = 'error';
          ctx.messages.push({ agentName: event.agentName, text: '⛔ 已拦截', kind: 'error' });
        } else {
          m.toolStatus = 'success';
        }
        return;
      }
    }
    const fallbackText = event.status === 'success' ? '✓ 完成'
      : event.status === 'error' ? `✗ ${event.message || '失败'}`
      : '⛔ 已拦截';
    ctx.messages.push({ agentName: event.agentName, text: fallbackText, kind: 'toolResult' });
  }

  handleError(event: ErrorEvent): void {
    const ctx = this.getContext(event.agentName);
    ctx.messages.push({ agentName: event.agentName, text: event.message, kind: 'error' });
  }

  handleDebug(event: DebugEvent): void {
    if (!this.debug) return;
    const ctx = this.getContext(event.agentName);
    ctx.messages.push({ agentName: event.agentName, text: `[DEBUG] ${event.data}`, kind: 'status' });
  }

  handleAgentTurnStart(event: AgentEvent, tracker: AgentTracker): void {
    if (event.agentName === 'main') {
      if (this.llmStatus === 'running') {
        debugLog(`ats:main alreadyRunning`);
        return;
      }
      this.llmStatus = 'running';
      this.llmTurnStartTime = Date.now();
      this.llmLastTokenTime = Date.now();
      this.responseLength.set('main', 0);
      debugLog(`ats:main running turnStart=${this.llmTurnStartTime}`);
      return;
    }

    // 子 agent
    tracker.startAgent(event.agentName, event.query, event.description);
    const type = extractAgentType(event.agentName);
    const querySnippet = event.query ? event.query.slice(0, 60).replace(/\n/g, ' ') : '';
    const ctx = this.getContext(event.agentName);
    ctx.messages.push({
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
    this.mainCtx.messages.push(summary);
    tracker.setStartMessage(event.agentName, summary);
  }

  handleAgentTurnEnd(event: AgentEvent, tracker: AgentTracker, registry?: PluginRegistry): void {
    const now = Date.now();
    if (event.agentName !== 'main') {
      const tokens = registry
        ? (registry.store.get<() => { totalTokens: number }>(tokenBudgetKey(event.agentName))?.()?.totalTokens
            ?? this.getEstimatedTurnTokens(event.agentName))
        : this.getEstimatedTurnTokens(event.agentName);
      const result = tracker.endAgent(event.agentName, tokens);
      if (!result) return;
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
      const ctx = this.getContext(event.agentName);
      ctx.messages.push({
        agentName: event.agentName,
        text: `完成 · ${duration} · ${ts}`,
        kind: 'turnComplete',
      });
      return;
    }

    // 主 agent
    if (this.llmStatus !== 'running') {
      debugLog(`ate:main notRunning`);
      return;
    }
    this.llmStatus = 'idle';
    debugLog(`ate:main idle responseLen=${this.responseLength.get('main')}`);
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
    this.mainCtx.messages.push({
      agentName: event.agentName,
      text: `完成 · ${duration} · ${ts}`,
      kind: 'turnComplete',
    });
  }

  handleBackgroundTask(event: BackgroundTaskEvent): void {
    const existing = this.backgroundTasks.findIndex(t => t.taskId === event.taskId);
    const bgStatus: BackgroundTaskInfo['status'] =
      event.taskStatus === 'started' ? 'running' : event.taskStatus;
    const info: BackgroundTaskInfo = {
      taskId: event.taskId, agentName: event.agentName, status: bgStatus, message: event.message,
    };
    if (existing >= 0) {
      this.backgroundTasks[existing] = info;
    } else {
      this.backgroundTasks.push(info);
    }
  }

  addContextAnalysis(analysis: ContextAnalysis): void {
    this.mainCtx.messages.push({ agentName: 'main', text: '', kind: 'status', contextAnalysis: analysis });
  }

  addModelSwitchMessage(label: string): void {
    this.mainCtx.messages.push({ agentName: 'main', text: `已切换到模型: ${label}`, kind: 'status' });
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

  addResponseDelta(agentName: string, delta: number | string): void {
    if (typeof delta === 'number') {
      if (delta <= 0) return;
      const prev = this.responseLength.get(agentName) ?? 0;
      const next = prev + delta;
      this.responseLength.set(agentName, next);
      debugLog(`addRd: agent=${agentName} delta=${delta} prev=${prev} next=${next}`);
    } else {
      if (!delta) return;
      const prev = this.responseLength.get(agentName) ?? 0;
      const next = prev + delta.length;
      this.responseLength.set(agentName, next);
      debugLog(`addRd: agent=${agentName} delta=${delta.length} prev=${prev} next=${next}`);
    }
  }

  getEstimatedTurnTokens(agentName: string = 'main'): number {
    return Math.round((this.responseLength.get(agentName) ?? 0) / 4);
  }
}
