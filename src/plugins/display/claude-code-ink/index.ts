import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, AgentEvent, StateSnapshot, MessageLevel } from '../../../display.js';
import type { ContextAnalysis } from '../../token-budget/analyzer.js';
import { inkRender, type Instance } from './ink.js';
import { InkApp, type UIMessage, type TextSegment, type PermissionPrompt, type PermissionResponse } from './InkApp.js';
import { ThinkStream } from '../think-stream.js';
import type { PluginRegistry } from '../../../core/plugin.js';
import type { AgentModeInfo } from '../../../core/store-keys.js';

import { SK } from '../../../core/store-keys.js';
import React from 'react';

/** 为常用工具生成简洁的参数预览，避免大 JSON 刷屏 */
export function getToolArgsPreview(args: any): string | null {
  if (!args || typeof args !== 'object') return null;

  // 工具函数：截断过长的字符串值
  const truncVal = (v: string, max = 80): string =>
    v.length > max ? v.slice(0, max) + '…' : v;

  // 工具函数：只保留关键的几个字段
  const pickKeys = (keys: string[]): string | null => {
    const parts: string[] = [];
    for (const k of keys) {
      const v = args[k];
      if (v !== undefined && v !== null) {
        parts.push(typeof v === 'string' ? truncVal(v) : String(v));
      }
    }
    return parts.length > 0 ? parts.join(', ') : null;
  };

  // 已知的大段内容字段名，始终跳过
  const BIG_FIELDS = new Set(['content', 'old_string', 'new_string', 'fileContent', 'fileContents', 'originalFile']);

  // 根据工具名称启发式选择展示字段
  // file_path 系工具（Read / Write / Edit / etc.）
  if (args.file_path) {
    const rest: string[] = [];
    for (const k of Object.keys(args)) {
      if (k === 'file_path' || BIG_FIELDS.has(k)) continue;
      const v = args[k];
      if (typeof v === 'string') rest.push(`${k}=${v}`);
      else rest.push(`${k}=${JSON.stringify(v)}`);
    }
    const pathPart = truncVal(args.file_path);
    return rest.length > 0 ? `${pathPart}, ${rest.join(', ')}` : pathPart;
  }

  // content/fileContent 类（没有 file_path 的）
  if (args.content !== undefined) {
    const parts: string[] = [];
    for (const k of Object.keys(args)) {
      if (k === 'content') continue;
      parts.push(`${k}=${typeof args[k] === 'string' ? args[k] : JSON.stringify(args[k])}`);
    }
    return parts.length > 0 ? parts.join(', ') : pickKeys(['content']);
  }

  // pattern/glob 类搜索工具
  if (args.pattern) return pickKeys(['pattern', 'path']);
  if (args.glob) return pickKeys(['glob', 'path']);

  // command/bash
  if (args.command) return `command: ${truncVal(args.command)}`;
  if (args.url) return pickKeys(['url']);

  return null; // 交给兜底的 JSON 截断
}

export interface CommandSuggestion {
  name: string;
  description: string;
  type: 'builtin' | 'skill' | 'agent';
}

/** 格式化工具调用：智能提取关键参数，避免大 JSON 刷屏 */
export function formatToolCall(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') {
    return `🔧 ${toolName}(${JSON.stringify(args)})`;
  }
  const preview = getToolArgsPreview(args);
  if (preview) {
    return `🔧 ${toolName}(${preview})`;
  }
  const str = JSON.stringify(args);
  const MAX_LEN = 200;
  if (str.length > MAX_LEN) {
    return `🔧 ${toolName}(${str.slice(0, MAX_LEN)}…)`;
  }
  return `🔧 ${toolName}(${str})`;
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
  // Permission confirm state — 支持 allow_once / always_allow / deny
  let pendingPermission: PermissionPrompt | null = null;
  let permissionResolve: ((value: boolean | 'always_allow') => void) | null = null;
  let registry: PluginRegistry | null = null;
  // Plugin manager overlay state
  let pluginManagerResolve: (() => void) | null = null;

  function cancelExecution(): void {
    if (registry) {
      registry.store.set(SK.AgentCancelled, true);
      const abortCtrl = registry.store.get<AbortController>(SK.AgentAbort);
      if (abortCtrl && !abortCtrl.signal.aborted) abortCtrl.abort();
    }
  }

  function render(): void {
    if (!inkInstance) return;
    const suggestions = _suggestionProvider?.() ?? [];
    try {
      const currentMode = (registry?.store?.get<string>(SK.Mode)) ?? 'normal';
      const currentTaskCount = (registry?.store?.get<number>(SK.TaskCount)) ?? 0;
      inkInstance.rerender(
        React.createElement(InkApp, {
          greeting,
          messages: [...messages],
          inputBuffer: '',
          suggestions,
          activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
          mode: currentMode as 'normal' | 'plan',
          taskCount: currentTaskCount,
          onInputChange: () => {},
          onInputSubmit: (text: string) => {
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
          pendingPermission = { toolName: req.toolName, message: req.message, details: req.details, diff: req.diff, filePath: req.filePath };
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
    },

    onStart(config: StartConfig): void {
      greeting = config.greeting;
      agentName = config.agentName;
      showThink = config.showThink === true;
    },

    onStop(message: string): void {
      if (inkInstance) {
        try { inkInstance.unmount(); } catch {}
        inkInstance = null;
      }
      messages = [];
      streamAccumulator = '';
      visibleAccumulator = '';
      thinkStream = null;
      lastStreamTarget = null;
      lastThinkTarget = null;
      console.log('\n' + message);
    },

    prompt(): Promise<string | null> {
      if (!inkInstance) {
        const initSuggestions = _suggestionProvider?.() ?? [];
        const initPromise = inkRender(
          React.createElement(InkApp, {
            greeting,
            messages: [...messages],
            inputBuffer: '',
            suggestions: initSuggestions,
            activeAgentName: registry?.store?.get<AgentModeInfo>(SK.AgentMode)?.name,
            onInputChange: () => {},
            onInputSubmit: (text: string) => {
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
      const kind = event.level === 'warn' ? 'warn' : event.level === 'error' ? 'error' : event.level === 'success' ? 'success' : 'status';
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
        text: formatToolCall(event.toolName, event.args),
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
      const { PluginManager } = await import('./PluginManager.js');
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
  };
}

export const inkDisplayPlugin: DisplayPlugin = createPlugin();
