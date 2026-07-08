import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, AgentEvent, BackgroundTaskEvent, StateSnapshot, MessageLevel } from '#src/display.js';
import type { ContextAnalysis } from '#src/plugins/token-budget/analyzer.js';
import { inkRender, type Instance } from '#src/plugins/display/claude-code-ink/ink.js';
import { InkApp, type UIMessage, type TextSegment, type PermissionPrompt, type PermissionResponse, type BackgroundTaskInfo } from '#src/plugins/display/claude-code-ink/InkApp.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';
import type { PluginRegistry } from '#src/core/plugin.js';
import type { AgentModeInfo } from '#src/core/store-keys.js';

import { SK, agentCancelledKey, agentAbortKey } from '#src/core/store-keys.js';
import type { ModelEntry } from '#src/core/llm.js';
import { logManager } from '#src/core/logger.js';
import { formatToolCall, getToolArgsPreview } from '#src/core/tool-display.js';
import React from 'react';

export interface CommandSuggestion {
  name: string;
  description: string;
  type: 'builtin' | 'skill' | 'agent';
}

function parseThinkSegments(text: string): TextSegment[] {
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

type InputResolve = (value: string | null) => void;

let _suggestionProvider: (() => CommandSuggestion[]) | null = null;

export function setSuggestionProvider(provider: (() => CommandSuggestion[]) | null): void {
  _suggestionProvider = provider;
}

function createPlugin(): DisplayPlugin {
  let inkInstance: Instance | null = null;
  let messages: UIMessage[] = [];
  let promptResolve: InputResolve | null = null;
  let greeting = '';
  let agentName = 'main';
  let showThink = false;
  let streamAccumulator = '';
  let visibleAccumulator = '';
  let thinkStream: ThinkStream | null = null;
  let lastStreamTarget: UIMessage | null = null;
  let lastThinkTarget: UIMessage | null = null;
  let greetingShown = false; // 是否已在消息列表中展示 greeting
  // Permission confirm state — 支持 allow_once / always_allow / deny
  let pendingPermission: PermissionPrompt | null = null;
  let permissionResolve: ((value: boolean | 'always_allow') => void) | null = null;
  let pendingQuestions: { questions: any[]; resolve: (answers: Record<string, string>) => void } | null = null;
  let registry: PluginRegistry | null = null;
  // Plugin manager overlay state
  let pluginManagerResolve: (() => void) | null = null;
  // Background task display state
  let backgroundTasks: BackgroundTaskInfo[] = [];
  let unsubMode: (() => void) | null = null;

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

  function handleModeToggle(): void {
    if (!registry) return;
    const currentMode = registry.store.get<string>(SK.Mode) || 'normal';
    if (currentMode === 'plan') {
      const preMode = registry.store.get<string>(SK.PrePlanMode) || 'normal';
      registry.store.set(SK.Mode, preMode);
      registry.store.set(SK.PrePlanMode, undefined);
    } else {
      registry.store.set(SK.PrePlanMode, currentMode);
      registry.store.set(SK.Mode, 'plan');
    }
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
            // @ 开头的输入：先尝试视图切换
            if (text.startsWith('@')) {
              if (handleViewSwitch(text)) return;
            }
            if (promptResolve) {
              const r = promptResolve;
              promptResolve = null;
              r(text);
            }
          },
          onExit: () => {
            if (promptResolve) {
              const r = promptResolve;
              promptResolve = null;
              r(null);
            } else {
              cancelExecution();
            }
          },
          pendingPermission,
          onPermissionResponse: (response: PermissionResponse) => {
            if (permissionResolve) {
              const r = permissionResolve;
              permissionResolve = null;
              pendingPermission = null;
              r(response === 'allow_once' ? true : response === 'always_allow' ? 'always_allow' : false);
              render();
            }
          },
          pendingQuestions,
          onQuestionsResponse: (answers: Record<string, string>) => {
            if (pendingQuestions) {
              const r = pendingQuestions.resolve;
              pendingQuestions = null;
              r(answers);
              render();
            }
          },
          onModeToggle: handleModeToggle,
        }),
      );
    } catch (err) {
      console.error('[claude-code-ink] render error:', err);
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
          pendingPermission = { toolName: req.toolName, displayName: req.displayName, message: req.message, details: req.details, diff: req.diff, filePath: req.filePath };
          permissionResolve = resolve;
          render();
        });
      });
      // Ink controls all terminal output; tool stdout/stderr is rendered
      // through the tool result message system, not written to the terminal.
      registry.setOutputHandler({
        stdout(_chunk: string) {},
        stderr(_chunk: string) {},
      });
      // Ink owns the terminal — suppress direct stderr writes
      logManager.unregister('stderr');
      // Register AskUserQuestion handler via shared store
      registry.store.set('askQuestions', async (questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string; preview?: string }>; multiSelect?: boolean }>) => {
        return new Promise<Record<string, string>>((resolve) => {
          pendingQuestions = { questions, resolve };
          render();
        });
      });

      // 订阅 mode 变化，确保 Ink 显示及时更新
      unsubMode = registry.store.subscribe(SK.Mode, () => render());
    },

    onStart(config: StartConfig): void {
      greeting = config.greeting;
      agentName = config.agentName;
      showThink = config.showThink === true;
    },

    onStop(message: string): void {
      unsubMode?.();
      unsubMode = null;
      if (inkInstance) {
        try { inkInstance.unmount(); } catch {}
        inkInstance = null;
      }
      messages = [];
      backgroundTasks = [];
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      console.log('\n' + message);
    },

    prompt(): Promise<string | null> {
      if (!inkInstance) {
        // 首次渲染：如果有消息（如 debug/think 状态消息），greeting 不会显示在欢迎页，
        // 因此将其加入消息列表头部，确保用户能看到它
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
              if (text.startsWith('@')) {
                if (handleViewSwitch(text)) return;
              }
              if (promptResolve) {
                const r = promptResolve;
                promptResolve = null;
                r(text);
              }
            },
            onExit: () => {
              if (promptResolve) {
                const r = promptResolve;
                promptResolve = null;
                r(null);
              } else {
                cancelExecution();
              }
            },
            onModeToggle: handleModeToggle,
          }),
          { stdout: process.stdout, stdin: process.stdin, stderr: process.stderr, exitOnCtrlC: false, patchConsole: false },
        );
        initPromise.then(inst => {
          inkInstance = inst;
        }).catch(err => {
          console.error('[claude-code-ink] failed to initialize Ink:', err);
        });
      }

      return new Promise<string | null>(resolve => {
        promptResolve = resolve;
      });
    },

    onUserInput(input: string, _sourcePlugin: string): void {
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      // Show user's query in message list (separate kind for scroll indicator)
      messages.push({ agentName, text: input, kind: 'userInput' });
      render();
    },

    onStatus(event: StatusEvent): void {
      if (event.level === 'status') {
        if (event.message === 'thinking') {
          messages.push({ agentName: event.agentName, text: '? 正在思考并请求大模型...', kind: 'thinking' });
        }
        // 'end' — no message push, just re-render
        render();
        return;
      }
      if (!event.message) { render(); return; }
      const kind: UIMessage['kind'] = event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' : event.level === 'success' ? 'success' : event.level === 'info' ? 'info' : 'status';
      // 非 main agent 的结果消息：清除旧消息，仅保留最新一次执行结果
      if (event.agentName !== 'main' && (event.level === 'success' || event.level === 'warn' || event.level === 'error')) {
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

        let anyUpdate = false;

        // Update or create thinking message (dimmed)
        if (thinkText) {
          if (lastThinkTarget != null
            && lastThinkTarget.kind === 'thinking'
            && lastThinkTarget.agentName === event.agentName) {
            lastThinkTarget.text = thinkText;
          } else {
            const msg: UIMessage = { agentName: event.agentName, text: thinkText, kind: 'thinking' };
            messages.push(msg);
            lastThinkTarget = msg;
            lastStreamTarget = null;
          }
          anyUpdate = true;
        }

        // Update or create stream message (normal text)
        if (normalText) {
          if (lastStreamTarget != null
            && lastStreamTarget.kind === 'stream'
            && lastStreamTarget.agentName === event.agentName) {
            lastStreamTarget.text = normalText;
          } else {
            const msg: UIMessage = { agentName: event.agentName, text: normalText, kind: 'stream' };
            messages.push(msg);
            lastStreamTarget = msg;
          }
          anyUpdate = true;
        }

        if (!anyUpdate) return;
      } else {
        if (!thinkStream) thinkStream = new ThinkStream();
        const filtered = thinkStream.next(event.text);
        if (!filtered) return;
        visibleAccumulator += filtered;
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
      messages.push({
        agentName: event.agentName,
        text: formatToolCall(event.toolName, event.args, registry?.getAllSchemas()),
        kind: 'toolCall',
      });
      render();
    },

    onToolResult(event: ToolResultEvent): void {
      const text = event.status === 'success'
        ? '✓ 工具执行完毕'
        : event.status === 'error'
          ? `✗ 工具执行失败: ${event.message || ''}`
          : '⛔ 已拦截';
      messages.push({ agentName: event.agentName, text, kind: 'toolResult' });
      render();
    },

    onError(event: ErrorEvent): void {
      messages.push({ agentName: event.agentName, text: event.message, kind: 'error' });
      render();
    },

    onAgentTurnStart(_event: AgentEvent): void {},

    onAgentTurnEnd(_event: AgentEvent): void {},

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
  };
}

export const inkDisplayPlugin: DisplayPlugin = createPlugin();
