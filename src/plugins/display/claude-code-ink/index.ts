import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, AgentEvent, BackgroundTaskEvent, StateSnapshot, MessageLevel, NotifyEvent } from '#src/display.js';
import type { ContextAnalysis } from '#src/core/contract.js';
import { inkRender, type Instance } from '#src/plugins/display/claude-code-ink/ink.js';
import { InkApp, type UIMessage, type TextSegment, type PermissionPrompt, type PermissionResponse, type BackgroundTaskInfo, type AgentRuntimeState, getAgentColor } from '#src/plugins/display/claude-code-ink/InkApp.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';
import type { PluginRegistry } from '#src/core/plugin.js';
import type { AgentModeInfo } from '#src/store-keys.js';

import { SK, agentCancelledKey, agentAbortKey } from '#src/store-keys.js';
import type { ModelEntry } from '#src/core/llm.js';
import { logManager } from '#src/utils/logger.js';
import { formatToolCall, getToolArgsPreview } from '#src/plugins/display/tool-display.js';
import type { ToolResponse } from '#src/core/contract.js';
import * as path from 'path';
import React from 'react';
import { enqueue, requestExit } from '#src/core/message-queue.js';

export interface CommandSuggestion {
  name: string;
  description: string;
  type: 'builtin' | 'skill' | 'agent';
}

export function parseThinkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let remaining = text;
  let inThink = false;

  while (remaining.length > 0) {
    if (!inThink) {
      // Check for lone </think> (without preceding <think>) — strip it
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

let _suggestionProvider: (() => CommandSuggestion[]) | null = null;

export function setSuggestionProvider(provider: (() => CommandSuggestion[]) | null): void {
  _suggestionProvider = provider;
}

/** @internal 纯切换逻辑（不涉及渲染），导出供测试使用 */
export function toggleMode(store: { get<T>(key: string): T | undefined; set<T>(key: string, value: T): void }): void {
  const currentMode = store.get<string>(SK.Mode) || 'normal';
  if (currentMode === 'plan') {
    const preMode = store.get<string>(SK.PrePlanMode) || 'normal';
    store.set(SK.Mode, preMode);
    store.set(SK.PrePlanMode, undefined);
  } else {
    store.set(SK.PrePlanMode, currentMode);
    store.set(SK.Mode, 'plan');
  }
}

function createPlugin(): DisplayPlugin {
  let inkInstance: Instance | null = null;
  let messages: UIMessage[] = [];
  let greeting = '';
  let agentName = 'main';
  let showThink = false;
  let debug = false;
  let streamAccumulator = '';
  let visibleAccumulator = '';
  let thinkStream: ThinkStream | null = null;
  let lastStreamTarget: UIMessage | null = null;
  let lastThinkTarget: UIMessage | null = null;
  let thinkingStatusMsg: UIMessage | null = null; // "正在思考"占位符，被 think 内容替换
  let greetingShown = false; // 是否已在消息列表中展示 greeting
  // Permission confirm state — 支持 allow_once / always_allow / deny
  // ── 统一弹窗队列（FIFO，一次只弹一个） ──
  interface ModalEntry {
    id: string;
    type: 'permission' | 'ask_question';
    data: any;
    resolve: (value: any) => void;
    toolName?: string;
  }

  const modalQueue: ModalEntry[] = [];
  let showingModal = false;
  let nextModalId = 0;

  async function processQueue(): Promise<void> {
    if (showingModal || modalQueue.length === 0) return;
    // 立即锁定，防止并行 confirmCallback 再次进入
    showingModal = true;

    const entry = modalQueue[0];

    // permission: 用 evaluator 重检查（路径级规则可能已通过前一个弹窗添加）
    if (entry.type === 'permission') {
      const evalFn = registry?.store?.get<any>('permission:evaluator');
      if (evalFn) {
        const req = entry.data;
        // 从 filePath 或 details 重构 args 供 evaluator 评估
        let fakeArgs: any = {};
        if (req.filePath) {
          fakeArgs = { path: req.filePath };
        } else if (req.details) {
          try {
            const parsed = JSON.parse(req.details);
            if (parsed?.path) fakeArgs = { path: parsed.path };
          } catch {}
        }
        const sideEffect = entry.toolName
          ? registry?.getToolSideEffect?.(entry.toolName, fakeArgs) ?? true
          : true;
        const decision = await evalFn(entry.toolName, fakeArgs, sideEffect);
        if (decision.behavior !== 'ask') {
          showingModal = false;
          modalQueue.shift();
          entry.resolve(decision.behavior === 'allow' ? true : 'always_allow');
          processQueue();
          return;
        }
      }
    }

    if (entry.type === 'permission') {
      const req = entry.data;
      pendingPermission = { toolName: req.toolName, displayName: req.displayName, message: req.message, details: req.details, diff: req.diff, filePath: req.filePath };
      permissionResolve = entry.resolve;
    } else {
      pendingQuestions = {
        questions: entry.data.questions,
        resolve: (answers: Record<string, string>) => {
          entry.resolve({ status: 'success', data: JSON.stringify({ questions: entry.data.questions, answers }) });
        },
      };
    }
    render();
  }

  function onModalComplete(): void {
    showingModal = false;
    pendingPermission = null;
    permissionResolve = null;
    pendingQuestions = null;
    modalQueue.shift();
    render();
    processQueue();
  }

  let pendingPermission: PermissionPrompt | null = null;
  let permissionResolve: ((value: boolean | 'always_allow') => void) | null = null;
  let pendingQuestions: { questions: any[]; resolve: (answers: Record<string, string>) => void } | null = null;
  let registry: PluginRegistry | null = null;
  // Plugin manager overlay state
  let pluginManagerResolve: (() => void) | null = null;
  // Background task display state
  let backgroundTasks: BackgroundTaskInfo[] = [];
  // Agent runtime tracking
  const agentStates = new Map<string, AgentRuntimeState>();
  const agentColors: Record<string, string> = {};
  // 指向主视图中 agent 启动摘要消息，便于 onAgentTurnEnd 更新
  const agentStartMessages = new Map<string, UIMessage>();
  // 定时更新 agent 进度消息的计时器（每秒刷新运行耗时）
  let agentProgressTimer: ReturnType<typeof setInterval> | null = null;
  // Status bar state — segments map for left side, notification for right side
  let statusSegments: Record<string, string> = {};
  let notification: { source: string; message: string } | null = null;
  let unsubMode: (() => void) | null = null;
  let restoreStderr: (() => void) | null = null;

  // ── LLM 执行状态追踪 ──
  let llmStatus: 'idle' | 'running' = 'idle';
  let llmTurnStartTime: number = 0;
  let llmPrevTokens: number = 0;
  let llmTurnTokens: number = 0;
  let sessionDateShown: string = ''; // 已显示完整日期的日期（YYYY-MM-DD），首个对话用

  function cancelExecution(): void {
    if (registry) {
      registry.store.set(agentCancelledKey(agentName), true);
      const abortCtrl = registry.store.get<AbortController>(agentAbortKey(agentName));
      if (abortCtrl && !abortCtrl.signal.aborted) abortCtrl.abort();
    }
  }

  /** 收集消息中出现的所有 agentName */
  function collectAgentNames(): Set<string> {
    const names = new Set<string>();
    names.add('main');
    for (const m of messages) {
      if (m.agentName && m.agentName !== 'main') names.add(m.agentName);
    }
    return names;
  }

  /** 处理 @ 开头的视图切换命令。返回 true 表示已处理（切换视图），false 表示不匹配 */
  function handleViewSwitch(text: string): boolean {
    if (!text.startsWith('@')) return false;
    const target = text.slice(1).trim();
    if (!target || target === 'main') {
      registry?.store?.set(SK.ViewAgent, undefined);
      render();
      return true;
    }
    const agentNames = collectAgentNames();
    // 精确匹配
    if (agentNames.has(target)) {
      registry?.store?.set(SK.ViewAgent, target);
      render();
      return true;
    }
    // 尝试 +_agent 后缀
    const withAgent = target + '_agent';
    if (agentNames.has(withAgent)) {
      registry?.store?.set(SK.ViewAgent, withAgent);
      render();
      return true;
    }
    return false;
  }

  /** 格式化耗时：Xs / Xm Ys / Xh Ym Zs（精确到秒） */
  function formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

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

  /** 从 agentName 中提取类型名（'explore_sync_abc123' → 'explore'） */
  function extractAgentType(agentName: string): string {
    if (agentName === 'main') return 'main';
    const syncIdx = agentName.indexOf('_sync_');
    if (syncIdx !== -1) return agentName.slice(0, syncIdx);
    const bgIdx = agentName.indexOf('_bg_');
    if (bgIdx !== -1) return agentName.slice(0, bgIdx);
    return agentName;
  }

  /** 刷新所有运行中 agent 的进度消息文本（工具计数 + 耗时） */
  function updateAgentProgress(): void {
    for (const [name, state] of agentStates) {
      if (state.status !== 'running') continue;
      const startMsg = agentStartMessages.get(name);
      if (!startMsg) continue;
      const elapsed = formatDuration(Date.now() - state.startTime);
      startMsg.text = `  ├─ ${state.type} · ${state.toolUseCount}工具 · ${elapsed}`;
    }
  }

  function startAgentTimer(): void {
    if (agentProgressTimer) return;
    agentProgressTimer = setInterval(() => {
      updateAgentProgress();
      render();
    }, 1000);
  }

  function stopAgentTimer(): void {
    if (!agentProgressTimer) return;
    clearInterval(agentProgressTimer);
    agentProgressTimer = null;
  }

  function handleModeToggle(): void {
    if (!registry) return;
    toggleMode(registry.store);
    render();
  }

  function render(): void {
    if (!inkInstance) return;
    const suggestions = _suggestionProvider?.() ?? [];
    try {
      const currentMode = (registry?.store?.get<string>(SK.Mode)) ?? 'normal';
      const currentTaskCount = (registry?.store?.get<number>(SK.TaskCount)) ?? 0;

      // 当前查看的 agent，undefined = 主视图
      const currentViewAgent = registry?.store?.get<string>(SK.ViewAgent) ?? undefined;

      // 收集 agentName，作为 @ 切换候选项
      const agentNames = collectAgentNames();
      const viewAgents = Array.from(agentNames)
        .map(name => ({
          name,
          label: name === 'main' ? '主对话' : name.replace(/_agent$/, ''),
        }));

      // 按视图过滤消息
      const filteredMessages = currentViewAgent
        ? messages.filter(m => m.agentName === currentViewAgent)
        : messages.filter(m => m.agentName === 'main');

      inkInstance.rerender(
        React.createElement(InkApp, {
          greeting,
          messages: [...filteredMessages],
          inputBuffer: '',
          suggestions,
          activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
          mode: currentMode as 'normal' | 'plan',
          taskCount: currentTaskCount,
          backgroundTasks,
          viewAgent: currentViewAgent,
          viewAgents,
          onViewAgentChange: (name: string) => {
            registry?.store?.set(SK.ViewAgent, name === 'main' ? undefined : name);
            render();
          },
          onViewAgentClear: () => {
            registry?.store?.set(SK.ViewAgent, undefined);
            render();
          },
          onInputChange: () => {},
          onInputSubmit: (text: string) => {
            if (text.startsWith('@') && handleViewSwitch(text)) return;
            enqueue({ mode: 'prompt', value: text });
          },
          onExit: () => {
            cancelExecution();
            requestExit();
          },
          pendingPermission,
          onPermissionResponse: (response: PermissionResponse) => {
            if (permissionResolve) {
              const r = permissionResolve;
              // "始终允许": 加路径级 session 规则（如 Read(/tmp/**)），而非工具级 allow
              if (response === 'always_allow' && pendingPermission?.filePath) {
                const permMgr = registry?.store?.get<any>('permission:manager');
                if (permMgr) {
                  const parentDir = path.dirname(path.resolve(pendingPermission.filePath));
                  permMgr.addSessionRule('allow', pendingPermission.toolName, parentDir + '/**');
                }
              }
              r(response === 'allow_once' ? true : response === 'always_allow' ? 'always_allow' : false);
              onModalComplete();
            }
          },
          pendingQuestions,
          onQuestionsResponse: (answers: Record<string, string>) => {
            if (pendingQuestions) {
              const r = pendingQuestions.resolve;
              r(answers);
              onModalComplete();
            }
          },
          onModeToggle: handleModeToggle,
          statusSegments,
          notification,
          llmStatus,
          llmStartTime: llmTurnStartTime,
          turnTokens: llmTurnTokens,
          agentColorMap: agentColors,
          agentStates: Array.from(agentStates.values()),
        }),
      );
    } catch (err) {
      // 静默捕获——不能用 console.error (直通 stderr 破坏 Ink 全屏)，
      // 也不能 push message + render (导致循环)。
      // React 内部已自己 catch + console.error 输出了，这里不再重复。
    }
  }

  return {
    name: 'claude-code-ink',
    ownsOutput: true,
    rawInput: true,

    async onInit(r: PluginRegistry): Promise<void> {
      registry = r;
      registry.setConfirmCallback(async (req) => {
        return new Promise<boolean | 'always_allow'>((resolve) => {
          modalQueue.push({
            id: `perm-${nextModalId++}`,
            type: 'permission',
            data: req,
            resolve,
            toolName: req.toolName,
          });
          processQueue();
        });
      });
      // Ink controls all terminal output; tool stdout/stderr is rendered
      // through the tool result message system, not written to the terminal.
      registry.setOutputHandler({
        stdout(_chunk: string) {},
        stderr(_chunk: string) {},
      });
      // Ink 控制终端输出，拦截所有第三方 stderr 写入避免破坏 alt-screen
      logManager.unregister('stderr');
      // 同 Ink 引擎 patchStderr：拦截 process.stderr.write，避免第三方
      // 直写 stderr（React 错误日志、插件输出等）腐蚀 Ink 的 alt-screen。
      // 路由到 logManager.display-bridge → onError → 通过 Ink 消息系统展示。
      // 重入保护防止 render-error → stderr → onError → render 递归。
      {
        const _origWrite = process.stderr.write.bind(process.stderr) as any;
        let _reentered = false;
        const intercept: any = (chunk: any, encodingOrCb: any, cb?: any) => {
          if (_reentered) return _origWrite(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : undefined, typeof encodingOrCb === 'function' ? encodingOrCb : cb);
          _reentered = true;
          try {
            const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
            if (text.trim()) logManager.error('stderr', text);
            (typeof encodingOrCb === 'function' ? encodingOrCb : cb)?.();
          } finally { _reentered = false; }
          return true;
        };
        process.stderr.write = intercept;
        restoreStderr = () => { if (process.stderr.write === intercept) process.stderr.write = _origWrite; };
      }
      registry.registerInteractiveHandler('ask_user_question', async (args: any) => {
        return new Promise<ToolResponse>((resolve) => {
          modalQueue.push({
            id: `ask-${nextModalId++}`,
            type: 'ask_question',
            data: args,
            resolve,
          });
          processQueue();
        });
      });

      // 订阅 mode 变化，同步到 statusSegments 并重新渲染
      unsubMode = registry.store.subscribe(SK.Mode, () => {
        const mode = registry?.store?.get<string>(SK.Mode);
        if (mode === 'plan' || mode === 'normal') {
          statusSegments = { ...statusSegments, mode };
        } else if (statusSegments.mode !== undefined) {
          const { mode: _, ...rest } = statusSegments;
          statusSegments = rest;
        }
        render();
      });

      // 初始化：读取当前 mode（订阅不会触发初始值，因 task-plan 在之前已设值）
      const initialMode = registry.store.get<string>(SK.Mode);
      if (initialMode === 'plan' || initialMode === 'normal') {
        statusSegments.mode = initialMode;
      }

      // 初始化斜杠命令建议（收集技能/命令/agent 列表供自动补全）
      const { initCommandSuggestions } = await import('#src/plugins/display/claude-code-ink/skills-bridge.js');
      initCommandSuggestions([]);
    },

    onStart(config: StartConfig): void {
      greeting = config.greeting;
      agentName = config.agentName;
      showThink = config.showThink === true;
      debug = config.debug === true;

      // 提前创建 Ink 渲染（不再等到 prompt() 首次调用）
      if (messages.length > 0 && !greetingShown) {
        messages.unshift({ agentName, text: greeting, kind: 'status' });
        greetingShown = true;
      }
      const initSuggestions = _suggestionProvider?.() ?? [];
      const initMode = (registry?.store?.get<string>(SK.Mode) ?? 'normal') as 'normal' | 'plan';
      const initPromise = inkRender(
        React.createElement(InkApp, {
          greeting,
          messages: [...messages],
          inputBuffer: '',
          suggestions: initSuggestions,
          activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
          mode: initMode,
          backgroundTasks,
          viewAgent: undefined,
          viewAgents: [{ name: 'main', label: '主对话' }],
          onViewAgentChange: (name: string) => {
            registry?.store?.set(SK.ViewAgent, name === 'main' ? undefined : name);
            render();
          },
          onViewAgentClear: () => {
            registry?.store?.set(SK.ViewAgent, undefined);
            render();
          },
          onInputChange: () => {},
          onInputSubmit: (text: string) => {
            if (text.startsWith('@') && handleViewSwitch(text)) return;
            enqueue({ mode: 'prompt', value: text });
          },
          onExit: () => {
            cancelExecution();
            requestExit();
          },
          onModeToggle: handleModeToggle,
          statusSegments,
          notification,
          llmStatus,
          llmStartTime: llmTurnStartTime,
          turnTokens: llmTurnTokens,
          agentColorMap: {},
          agentStates: [],
        }),
        { stdout: process.stdout, stdin: process.stdin, stderr: process.stderr, exitOnCtrlC: false, patchConsole: false },
      );
      initPromise.then(inst => {
        inkInstance = inst;
      }).catch(err => {
        // Ink 未初始化完成，stderr 仍是原始终端，可用
        process.stderr.write(`[claude-code-ink] failed to initialize Ink: ${err instanceof Error ? err.message : String(err)}\n`);
      });
    },

    onStop(message: string): void {
      restoreStderr?.();
      restoreStderr = null;
      unsubMode?.();
      unsubMode = null;
      if (inkInstance) {
        try { inkInstance.unmount(); } catch {}
        inkInstance = null;
      }
      messages = [];
      backgroundTasks = [];
      stopAgentTimer();
      agentStates.clear();
      agentStartMessages.clear();
      for (const key of Object.keys(agentColors)) delete agentColors[key];
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      thinkingStatusMsg = null;
      // Ink 已 unmount，直接用 stdout 写退出消息
      process.stdout.write('\n' + message + '\n');
    },

    prompt(): Promise<string | null> {
      // 输入由 onInputSubmit → enqueue() 处理，退出由 onExit → requestExit() 处理
      // prompt() 不再承担实际功能，返回永不 resolve 的 Promise
      return new Promise<string | null>(() => {});
    },

    onUserInput(input: string, _sourcePlugin: string): void {
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      thinkingStatusMsg = null;
      // 新对话开始，清除所有子 agent 状态（含因异常未触发 onAgentTurnEnd 的残留）
      stopAgentTimer();
      agentStates.clear();
      agentStartMessages.clear();
      for (const key of Object.keys(agentColors)) delete agentColors[key];
      // Show user's query in message list (separate kind for scroll indicator)
      messages.push({ agentName, text: input, kind: 'userInput' });
      render();
    },

    onStatus(event: StatusEvent): void {
      if (event.level === 'status') {
        if (event.message === 'thinking') {
          // --think 模式下才展示"正在思考"占位（后续被 think 内容替换）
          if (showThink) {
            const msg: UIMessage = { agentName: event.agentName, text: '? 正在思考并请求大模型...', kind: 'thinking' };
            messages.push(msg);
            thinkingStatusMsg = msg;
          }
        }
        // 'end' — no message push, just re-render
        render();
        return;
      }
      if (!event.message) { render(); return; }
      const kind: UIMessage['kind'] = event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' : event.level === 'success' ? 'success' : event.level === 'info' ? 'info' : 'status';
      // 非 main agent 且被 agentStates 追踪时：仅清除该 agent 的流式消息，保留启动/完成摘要
      if (event.agentName !== 'main' && agentStates.has(event.agentName)) {
        messages = messages.filter(m => !(m.agentName === event.agentName && (m.kind === 'stream' || m.kind === 'thinking' || m.kind === 'toolCall')));
      } else if (event.agentName !== 'main' && (event.level === 'success' || event.level === 'warn' || event.level === 'error')) {
        // 未追踪的 agent：旧逻辑，清除所有该 agent 消息
        messages = messages.filter(m => m.agentName !== event.agentName);
      }
      messages.push({ agentName: event.agentName, text: event.message, kind });
      render();
    },

    onStreamChunk(event: StreamEvent): void {
      if (!event.text) return;

      if (showThink) {
        streamAccumulator += event.text;
        const segments = parseThinkSegments(streamAccumulator);

        // Separate think and non-think text so they render as distinct
        // messages — same architecture as Claude Code's
        // AssistantThinkingMessage vs AssistantTextMessage.
        let thinkText = '';
        let normalText = '';
        for (const seg of segments) {
          if (seg.dim) thinkText += seg.text;
          else normalText += seg.text;
        }
        // </think> 后面的前导 \n 如果不清理，stream 消息开头会产生空行，
        // 导致 ● 前缀旁是空行而内容在下一行，看起来就像 ● 悬空了。
        normalText = normalText.replace(/^\n+/, '');

        let anyUpdate = false;

        // Update or create thinking message (dimmed)
        if (thinkText) {
          // 有 "正在思考" 占位符 → 替换为实际 think 内容（保证顺序在 stream 之前）
          if (thinkingStatusMsg) {
            thinkingStatusMsg.text = thinkText;
            lastThinkTarget = thinkingStatusMsg;
            thinkingStatusMsg = null;
          } else if (lastThinkTarget != null
            && lastThinkTarget.kind === 'thinking'
            && lastThinkTarget.agentName === event.agentName) {
            lastThinkTarget.text = thinkText;
          } else {
            const msg: UIMessage = { agentName: event.agentName, text: thinkText, kind: 'thinking' };
            messages.push(msg);
            lastThinkTarget = msg;
          }
          anyUpdate = true;
        }

        // Update or create stream message (normal text)
        if (lastStreamTarget != null
          && lastStreamTarget.kind === 'stream'
          && lastStreamTarget.agentName === event.agentName) {
          // Always update existing stream — 当 </think> 把已显示的文本重分类为 think 时，
          // normalText 可能变短，stream 消息需要同步裁短以避免重复显示
          if (normalText !== lastStreamTarget.text) {
            lastStreamTarget.text = normalText;
            anyUpdate = true;
          }
        } else if (normalText) {
          const msg: UIMessage = { agentName: event.agentName, text: normalText, kind: 'stream' };
          messages.push(msg);
          lastStreamTarget = msg;
          anyUpdate = true;
        }

        if (!anyUpdate) return;
      } else {
        if (!thinkStream) thinkStream = new ThinkStream();
        const filtered = thinkStream.next(event.text);
        if (!filtered) return;
        // 清理 </think> 后的前导换行，避免 stream 消息开头产生空行（● 悬空）
        const cleaned = !visibleAccumulator ? filtered.replace(/^\n+/, '') : filtered;
        if (!cleaned) return;
        visibleAccumulator += cleaned;
        const visible = visibleAccumulator;

        const last = messages[messages.length - 1];
        const sameStream = last && last.agentName === event.agentName && last.kind === 'stream';

        if (sameStream && lastStreamTarget === last) {
          last.text = visible;
        } else {
          messages.push({ agentName: event.agentName, text: visible, kind: 'stream' });
          lastStreamTarget = messages[messages.length - 1];
        }
      }
      render();
    },

    onToolCall(event: ToolCallEvent): void {
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      thinkingStatusMsg = null;

      // 子 agent 工具调用：递增计数，同步更新主视图进度消息
      if (event.agentName !== 'main') {
        const state = agentStates.get(event.agentName);
        if (state) {
          state.toolUseCount++;
          state.lastToolName = event.toolName;
          // 更新主视图中的进度消息：工具计数 + 耗时
          const startMsg = agentStartMessages.get(event.agentName);
          if (startMsg) {
            const elapsed = formatDuration(Date.now() - state.startTime);
            startMsg.text = `  ├─ ${state.type} · ${state.toolUseCount}工具 · ${elapsed}`;
          }
        }
      }

      // 每次 LLM 返回（调用工具前）更新本轮 token 计数
      if (registry && llmStatus === 'running') {
        const getUsage = registry.store.get<() => { inputTokens: number; outputTokens: number; totalTokens: number }>(SK.TokenBudgetGetApiUsage);
        if (getUsage) {
          const usage = getUsage();
          llmTurnTokens = usage.outputTokens - llmPrevTokens;
        }
      }

      const raw = formatToolCall(event.toolName, event.args, registry?.getAllSchemas());
      // 去掉 🔧 emoji — 改用 toolStatus 指示器
      const text = raw.replace(/^🔧\s*/, '');
      messages.push({
        agentName: event.agentName,
        text,
        kind: 'toolCall',
        toolStatus: 'running',
      });
      render();
    },

    onToolResult(event: ToolResultEvent): void {
      // 找到该 agent 最后一个 running 的工具调用消息，更新其状态
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.agentName === event.agentName && m.kind === 'toolCall' && m.toolStatus === 'running') {
          if (event.status === 'error') {
            m.toolStatus = 'error';
            // 错误时追加错误消息
            if (event.message) {
              messages.push({
                agentName: event.agentName,
                text: `✗ ${event.message}`,
                kind: 'error',
              });
            }
          } else if (event.status === 'rejected_by_user') {
            m.toolStatus = 'error';
            messages.push({
              agentName: event.agentName,
              text: '⛔ 已拦截',
              kind: 'error',
            });
          } else {
            m.toolStatus = 'success';
            // success 不追加额外消息行
          }
          render();
          return;
        }
      }
      // 未找到匹配的 running 消息（异常情况），退回到旧行为
      const fallbackText = event.status === 'success'
        ? '✓ 完成'
        : event.status === 'error'
          ? `✗ ${event.message || '失败'}`
          : '⛔ 已拦截';
      messages.push({ agentName: event.agentName, text: fallbackText, kind: 'toolResult' });
      render();
    },

    onError(event: ErrorEvent): void {
      messages.push({ agentName: event.agentName, text: event.message, kind: 'error' });
      render();
    },

    onDebug(event: DebugEvent): void {
      if (!debug) return;
      messages.push({ agentName: event.agentName, text: `[DEBUG] ${event.data}`, kind: 'status' });
      render();
    },

    onAgentTurnStart(_event: AgentEvent): void {
      const isMain = _event.agentName === 'main';
      // 子 agent 启动：记录状态、推送到主视图
      if (!isMain) {
        const type = extractAgentType(_event.agentName);
        if (!agentColors[_event.agentName]) {
          agentColors[_event.agentName] = getAgentColor(type);
        }
        agentStates.set(_event.agentName, {
          type,
          fullName: _event.agentName,
          status: 'running',
          startTime: Date.now(),
          toolUseCount: 0,
        });
        // 在主视图中推送启动摘要 — CC 风格：树形字符 + type + 状态
        const statusMsg: UIMessage = {
          agentName: 'main',
          text: `  ├─ ${type} · 搜索中...`,
          kind: 'info',
        };
        messages.push(statusMsg);
        agentStartMessages.set(_event.agentName, statusMsg);
        startAgentTimer();
        render();
        return;
      }
      // 主 agent — 管理 LLM 状态栏
      if (llmStatus === 'running') return;
      llmStatus = 'running';
      llmTurnStartTime = Date.now();
      // 记录当前累积 token 作为基线
      if (registry) {
        const getUsage = registry.store.get<() => { inputTokens: number; outputTokens: number; totalTokens: number }>(SK.TokenBudgetGetApiUsage);
        if (getUsage) {
          const usage = getUsage();
          llmPrevTokens = usage.outputTokens;
        }
      }
      llmTurnTokens = 0;
      render();
    },

    onAgentTurnEnd(_event: AgentEvent): void {
      const now = Date.now();
      const isMain = _event.agentName === 'main';

      // 子 agent 结束：更新状态、更新主视图摘要
      if (!isMain) {
        const state = agentStates.get(_event.agentName);
        // 防止重复处理同一 agent 的 onAgentTurnEnd
        if (state && state.status !== 'running') {
          render();
          return;
        }
        if (state) {
          state.status = 'completed';
          state.endTime = now;
        }
        // 更新主视图中的启动摘要为完成摘要 — CC 风格：└─ + 完成 + 工具计数 + 耗时
        const startMsg = agentStartMessages.get(_event.agentName);
        if (startMsg && state) {
          const elapsed = formatDuration(state.endTime! - state.startTime);
          startMsg.text = `  └─ ${state.type} · 完成 · ${state.toolUseCount}工具 · ${elapsed}`;
          agentStartMessages.delete(_event.agentName);
        }
        // 仅在所有子 agent 都完成时才停止进度计时器
        if (!Array.from(agentStates.values()).some(s => s.status === 'running')) {
          stopAgentTimer();
        }
        // 子 agent 仍记录时间戳
        const elapsedMs = state ? state.endTime! - state.startTime : 0;
        const duration = formatDuration(elapsedMs);
        const today = formatDate(now);
        let ts: string;
        if (sessionDateShown !== today) {
          sessionDateShown = today;
          ts = `${today} ${formatTime(now)}`;
        } else {
          ts = formatTime(now);
        }
        messages.push({
          agentName: _event.agentName,
          text: `完成 · ${duration} · ${ts}`,
          kind: 'turnComplete',
        });
        render();
        return;
      }

      // 仅主 agent 结束 turn 时修改全局 llmStatus，子 agent 复用同一 display
      // 实例，若重置 llmStatus 会导致主 agent 状态栏计时器在子 agent 完成后过早消失
      llmStatus = 'idle';
      // 更新本轮 token
      if (registry) {
        const getUsage = registry.store.get<() => { inputTokens: number; outputTokens: number; totalTokens: number }>(SK.TokenBudgetGetApiUsage);
        if (getUsage) {
          const usage = getUsage();
          llmTurnTokens = usage.outputTokens - llmPrevTokens;
        }
      }

      // 生成完成时间戳行
      const elapsedMs = now - llmTurnStartTime;
      const today = formatDate(now);
      let ts: string;
      if (sessionDateShown !== today) {
        sessionDateShown = today;
        ts = `${today} ${formatTime(now)}`;
      } else {
        ts = formatTime(now);
      }
      const duration = formatDuration(elapsedMs);
      messages.push({
        agentName: _event.agentName,
        text: `完成 · ${duration} · ${ts}`,
        kind: 'turnComplete',
      });
      render();
    },

    onStateSnapshot(_snapshot: StateSnapshot): void {},

    onBackgroundTask(event: BackgroundTaskEvent): void {
      const existing = backgroundTasks.findIndex((t) => t.taskId === event.taskId);
      const bgStatus: BackgroundTaskInfo['status'] =
        event.taskStatus === 'started' ? 'running' : event.taskStatus;
      const info: BackgroundTaskInfo = {
        taskId: event.taskId,
        agentName: event.agentName,
        status: bgStatus,
        message: event.message,
      };

      if (existing >= 0) {
        backgroundTasks[existing] = info;
      } else {
        backgroundTasks.push(info);
      }

      // Auto-remove completed/error tasks after 5 seconds
      if (event.taskStatus === 'completed' || event.taskStatus === 'error') {
        setTimeout(() => {
          backgroundTasks = backgroundTasks.filter((t) => t.taskId !== event.taskId);
          render();
        }, 5000);
      }

      render();
    },

    onContextAnalysis(analysis: ContextAnalysis): void {
      messages.push({
        agentName: 'main',
        text: '',
        kind: 'status',
        contextAnalysis: analysis,
      });
      render();
    },

    async showPluginManager(r: PluginRegistry): Promise<boolean> {
      if (!inkInstance) return false;

      // 渲染 PluginManager 覆盖主界面
      const { PluginManager } = await import('#src/plugins/display/claude-code-ink/PluginManager.js');
      inkInstance.rerender(
        React.createElement(PluginManager, {
          registry: r,
          onDone: () => {
            if (pluginManagerResolve) {
              const r2 = pluginManagerResolve;
              pluginManagerResolve = null;
              r2();
            }
          },
        }),
      );

      // 等待用户退出，然后恢复主界面
      await new Promise<void>(resolve => {
        pluginManagerResolve = resolve;
      });

      // 恢复 InkApp 主界面
      render();
      return true;
    },

    async showModelPicker(r: PluginRegistry): Promise<boolean> {
      if (!inkInstance) return false;
      if (!r.store.get(SK.ModelRegistryModels)) return false;

      // 记录切换前的模型，用于对比
      const before = r.store.get<ModelEntry>(SK.ModelOverride);
      const beforeLabel = before ? `${before.provider ? before.provider + '/' : ''}${before.model}` : null;

      const { ModelPicker } = await import('#src/plugins/display/claude-code-ink/ModelPicker.js');
      let pickerResolve: (() => void) | null = null;

      inkInstance.rerender(
        React.createElement(ModelPicker, {
          registry: r,
          onDone: () => {
            if (pickerResolve) {
              const r2 = pickerResolve;
              pickerResolve = null;
              r2();
            }
          },
        }),
      );

      await new Promise<void>(resolve => {
        pickerResolve = resolve;
      });

      // 如果模型有变化，推送提示
      const after = r.store.get<ModelEntry>(SK.ModelOverride);
      if (after && (!before || before.model !== after.model || before.apiKey !== after.apiKey)) {
        const label = `${after.provider ? after.provider + '/' : ''}${after.model}`;
        if (label !== beforeLabel) {
          messages.push({ agentName: 'main', text: `已切换到模型: ${label}`, kind: 'status' });
        }
      }

      render();
      return true;
    },

    setStatusBar(segments: Record<string, string>): void {
      statusSegments = segments;
      // 从 SK.Mode 同步 mode 状态：
      // mode 由 store 订阅管理，外部 setStatusBar(key, null) 的广播不应抹掉它
      const currentMode = registry?.store?.get<string>(SK.Mode);
      if (currentMode === 'plan' || currentMode === 'normal') {
        statusSegments.mode = currentMode;
      } else {
        delete statusSegments.mode;
      }
      render();
    },

    onNotify(n: NotifyEvent | null): void {
      notification = n;
      render();
    },
  };
}

export const inkDisplayPlugin: DisplayPlugin = createPlugin();
