import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, AgentEvent, BackgroundTaskEvent, StateSnapshot, NotifyEvent } from '#src/display.js';
import type { ContextAnalysis } from '#src/core/contract.js';
import { inkRender, type Instance } from '#src/plugins/display/claude-code-ink/ink.js';
import { InkApp, type UIMessage, type PermissionPrompt, type PermissionResponse, type AgentRuntimeState, type BackgroundTaskInfo } from '#src/plugins/display/claude-code-ink/InkApp.js';
import type { PluginRegistry } from '#src/core/plugin.js';
import type { AgentModeInfo } from '#src/store-keys.js';
import { SK, agentCancelledKey, agentAbortKey } from '#src/store-keys.js';
import type { ModelEntry } from '#src/core/llm.js';
import { logManager } from '#src/utils/logger.js';
import { enqueue, requestExit } from '#src/core/message-queue.js';
import React from 'react';
import * as path from 'path';

import { DisplayState, parseThinkSegments } from '#src/plugins/display/claude-code-ink/display-state.js';
import { AgentTracker } from '#src/plugins/display/claude-code-ink/agent-tracker.js';
import { ModalQueue } from '#src/plugins/display/claude-code-ink/modal-queue.js';

// ──────── Module-level exports ────────

export { parseThinkSegments };

export interface CommandSuggestion {
  name: string;
  description: string;
  type: 'builtin' | 'skill' | 'agent';
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

// ──────── Plugin Factory ────────

function createPlugin(): DisplayPlugin {
  let inkInstance: Instance | null = null;
  let registry: PluginRegistry | null = null;
  let pluginManagerResolve: (() => void) | null = null;
  let unsubMode: (() => void) | null = null;
  let restoreStderr: (() => void) | null = null;
  let statusLineTimer: ReturnType<typeof setInterval> | null = null;

  const state = new DisplayState();
  const tracker = new AgentTracker();
  const modalQueue = new ModalQueue();
  tracker.setRenderFn(render);
  modalQueue.setRenderFn(render);

  // ──────── 工具函数 ────────

  function cancelExecution(): void {
    if (registry) {
      registry.store.set(agentCancelledKey(state.agentName), true);
      const abortCtrl = registry.store.get<AbortController>(agentAbortKey(state.agentName));
      if (abortCtrl && !abortCtrl.signal.aborted) abortCtrl.abort();
    }
  }

  /** 收集消息中出现的所有 agentName */
  function collectAgentNames(): Set<string> {
    return state.collectAgentNames();
  }

  /** 处理 @ 开头的视图切换命令 */
  function handleViewSwitch(text: string): boolean {
    if (!text.startsWith('@')) return false;
    const target = text.slice(1).trim();
    if (!target || target === 'main') {
      registry?.store?.set(SK.ViewAgent, undefined);
      render();
      return true;
    }
    const agentNames = collectAgentNames();
    if (agentNames.has(target)) {
      registry?.store?.set(SK.ViewAgent, target);
      render();
      return true;
    }
    const withAgent = target + '_agent';
    if (agentNames.has(withAgent)) {
      registry?.store?.set(SK.ViewAgent, withAgent);
      render();
      return true;
    }
    return false;
  }

  function handleModeToggle(): void {
    if (!registry) return;
    toggleMode(registry.store);
    render();
  }

  // ──────── Render ────────

  function render(): void {
    if (!inkInstance) return;
    const suggestions = _suggestionProvider?.() ?? [];
    try {
      const currentMode = (registry?.store?.get<string>(SK.Mode)) ?? 'normal';
      const currentTaskCount = (registry?.store?.get<number>(SK.TaskCount)) ?? 0;
      const currentViewAgent = registry?.store?.get<string>(SK.ViewAgent) ?? undefined;
      const agentNames = collectAgentNames();
      const viewAgents = Array.from(agentNames).map(name => ({
        name,
        label: name === 'main' ? '主对话' : name.replace(/_agent$/, ''),
      }));
      const filteredMessages = state.filteredMessages(currentViewAgent);
      const pendingPermission = modalQueue.getPendingPermission();
      const pendingQuestions = modalQueue.getPendingQuestions();

      inkInstance.rerender(
        React.createElement(InkApp, {
          greeting: state.greeting,
          messages: [...filteredMessages],
          inputBuffer: '',
          suggestions,
          activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
          mode: currentMode as 'normal' | 'plan',
          taskCount: currentTaskCount,
          backgroundTasks: state.backgroundTasks,
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
            modalQueue.handlePermissionResponse(response);
          },
          pendingQuestions,
          onQuestionsResponse: (answers: Record<string, string>) => {
            modalQueue.handleQuestionsResponse(answers);
          },
          onModeToggle: handleModeToggle,
          statusSegments: state.statusSegments,
          notification: state.notification,
          llmStatus: state.llmStatus,
          llmStartTime: state.llmTurnStartTime,
          turnTokens: state.getEstimatedTurnTokens(),
          llmLastTokenTime: state.llmLastTokenTime,
          agentColorMap: tracker.colors,
          agentStates: Array.from(tracker.states.values()),
        }),
      );
    } catch {
      // 静默捕获——React 内部已自行 console.error
    }
  }

  // ──────── DisplayPlugin ────────

  return {
    name: 'claude-code-ink',
    ownsOutput: true,
    rawInput: true,

    async onInit(r: PluginRegistry): Promise<void> {
      registry = r;

      // 注册 modal handler
      modalQueue.registerHandlers(r);

      // Ink 控制终端输出
      registry.setOutputHandler({
        stdout(_chunk: string) {},
        stderr(_chunk: string) {},
      });
      logManager.unregister('stderr');
      // stderr 拦截防止破坏 alt-screen
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

      // 订阅 mode 变化
      unsubMode = registry.store.subscribe(SK.Mode, () => {
        const mode = registry?.store?.get<string>(SK.Mode);
        if (mode === 'plan' || mode === 'normal') {
          state.statusSegments = { ...state.statusSegments, mode };
        } else if (state.statusSegments.mode !== undefined) {
          const { mode: _, ...rest } = state.statusSegments;
          state.statusSegments = rest;
        }
        render();
      });

      const initialMode = registry.store.get<string>(SK.Mode);
      if (initialMode === 'plan' || initialMode === 'normal') {
        state.statusSegments.mode = initialMode;
      }

      const { initCommandSuggestions } = await import('#src/plugins/display/claude-code-ink/skills-bridge.js');
      initCommandSuggestions([]);

      // StatusBar shell hook
      const inkConfig = registry.getPluginConfig('claude-code-ink');
      const statusLineCommand = inkConfig?.statusLineCommand as string | undefined;
      if (statusLineCommand) {
        const { exec } = await import('child_process');
        const runStatusLine = (): void => {
          exec(statusLineCommand, { timeout: 5000 }, (err, stdout) => {
            if (err) return;
            const lines = stdout.split('\n').filter(Boolean);
            const parsed: Record<string, string> = {};
            for (const line of lines) {
              const sep = line.indexOf(':');
              if (sep > 0) parsed[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
            }
            state.statusSegments = { ...state.statusSegments, ...parsed };
            render();
          });
        };
        runStatusLine();
        statusLineTimer = setInterval(runStatusLine, 5000);
      }
    },

    onStart(config: StartConfig): void {
      state.greeting = config.greeting;
      state.agentName = config.agentName;
      state.showThink = config.showThink === true;
      state.debug = config.debug === true;

      const mainMessages = state.agentMessages.get('main')!;
      if (mainMessages.length > 0 && !state.greetingShown) {
        mainMessages.unshift({ agentName: state.agentName, text: state.greeting, kind: 'status' });
        state.greetingShown = true;
      }
      const initSuggestions = _suggestionProvider?.() ?? [];
      const initMode = (registry?.store?.get<string>(SK.Mode) ?? 'normal') as 'normal' | 'plan';
      const initPromise = inkRender(
        React.createElement(InkApp, {
          greeting: state.greeting,
          messages: [...(state.agentMessages.get('main') ?? [])],
          inputBuffer: '',
          suggestions: initSuggestions,
          activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
          mode: initMode,
          backgroundTasks: state.backgroundTasks,
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
          statusSegments: state.statusSegments,
          notification: state.notification,
          llmStatus: state.llmStatus,
          llmStartTime: state.llmTurnStartTime,
          turnTokens: state.getEstimatedTurnTokens(),
          llmLastTokenTime: state.llmLastTokenTime,
          agentColorMap: {},
          agentStates: [],
        }),
        { stdout: process.stdout, stdin: process.stdin, stderr: process.stderr, exitOnCtrlC: false, patchConsole: false },
      );
      initPromise.then(inst => { inkInstance = inst; }).catch(() => {});
    },

    onStop(message: string): void {
      if (statusLineTimer) { clearInterval(statusLineTimer); statusLineTimer = null; }
      restoreStderr?.();
      restoreStderr = null;
      unsubMode?.();
      unsubMode = null;
      if (inkInstance) {
        try { inkInstance.unmount(); } catch {}
        inkInstance = null;
      }
      state.resetAll();
      tracker.clearAll();
      modalQueue.clearAll();
      process.stdout.write('\n' + message + '\n');
    },

    prompt(): Promise<string | null> {
      return new Promise<string | null>(() => {});
    },

    onUserInput(input: string, _sourcePlugin: string): void {
      state.resetStream();
      state.llmLastTokenTime = 0;
      tracker.clearAll();
      state.clearAgentMessages();
      state.addUserInput(state.agentName, input);
      render();
    },

    onStatus(event: StatusEvent): void {
      state.handleStatus(event, tracker);
      render();
    },

    onStreamChunk(event: StreamEvent): void {
      const updated = state.handleStreamChunk(event);
      // 仅主 agent 的流式文本计入 responseLength（副 agent 在子 transcript 中）
      if (event.agentName === 'main') {
        state.addResponseDelta(event.text ?? '');
      }
      if (updated) render();
    },

    onToolCall(event: ToolCallEvent): void {
      state.resetStream();
      tracker.updateToolCall(event.agentName, event.toolName, registry ?? undefined);
      state.addToolCall(event, registry ?? undefined);
      render();
    },

    onToolResult(event: ToolResultEvent): void {
      state.handleToolResult(event);
      render();
    },

    onError(event: ErrorEvent): void {
      state.handleError(event);
      render();
    },

    onDebug(event: DebugEvent): void {
      state.handleDebug(event);
      render();
    },

    onAgentTurnStart(_event: AgentEvent): void {
      if (_event.agentName === 'main') {
        // 主 agent — 管理 LLM 状态栏
        if (state.llmStatus === 'running') return;
        state.llmStatus = 'running';
        state.llmTurnStartTime = Date.now();
        state.llmLastTokenTime = Date.now();
        state.responseLength = 0;
      } else {
        state.handleAgentTurnStart(_event, tracker);
      }
      render();
    },

    onAgentTurnEnd(_event: AgentEvent): void {
      state.handleAgentTurnEnd(_event, tracker, registry ?? undefined);
      render();
    },

    onStateSnapshot(_snapshot: StateSnapshot): void {},

    onBackgroundTask(event: BackgroundTaskEvent): void {
      state.handleBackgroundTask(event);
      if (event.taskStatus === 'completed' || event.taskStatus === 'error') {
        setTimeout(() => {
          state.backgroundTasks = state.backgroundTasks.filter(t => t.taskId !== event.taskId);
          render();
        }, 5000);
      }
      render();
    },

    onContextAnalysis(analysis: ContextAnalysis): void {
      state.addContextAnalysis(analysis);
      render();
    },

    async showPluginManager(r: PluginRegistry): Promise<boolean> {
      if (!inkInstance) return false;
      const { PluginManager } = await import('#src/plugins/display/claude-code-ink/PluginManager.js');
      inkInstance.rerender(
        React.createElement(PluginManager, {
          registry: r,
          onDone: () => { pluginManagerResolve?.(); pluginManagerResolve = null; },
        }),
      );
      await new Promise<void>(resolve => { pluginManagerResolve = resolve; });
      render();
      return true;
    },

    async showModelPicker(r: PluginRegistry): Promise<boolean> {
      if (!inkInstance) return false;
      if (!r.store.get(SK.ModelRegistryModels)) return false;

      const before = r.store.get<ModelEntry>(SK.ModelOverride);
      const beforeLabel = before ? `${before.provider ? before.provider + '/' : ''}${before.model}` : null;

      const { ModelPicker } = await import('#src/plugins/display/claude-code-ink/ModelPicker.js');
      let pickerResolve: (() => void) | null = null;
      inkInstance.rerender(
        React.createElement(ModelPicker, {
          registry: r,
          onDone: () => { pickerResolve?.(); pickerResolve = null; },
        }),
      );
      await new Promise<void>(resolve => { pickerResolve = resolve; });

      const after = r.store.get<ModelEntry>(SK.ModelOverride);
      if (after && (!before || before.model !== after.model || before.apiKey !== after.apiKey)) {
        const label = `${after.provider ? after.provider + '/' : ''}${after.model}`;
        if (label !== beforeLabel) state.addModelSwitchMessage(label);
      }
      render();
      return true;
    },

    setStatusBar(segments: Record<string, string>): void {
      const currentMode = registry?.store?.get<string>(SK.Mode);
      state.setStatusBar(segments, currentMode);
      render();
    },

    onNotify(n: NotifyEvent | null): void {
      state.setNotification(n);
      render();
    },
  };
}

export const inkDisplayPlugin: DisplayPlugin = createPlugin();
