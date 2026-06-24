import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, AgentEvent, StateSnapshot } from '../../../display.js';
import { inkRender, type Instance } from './ink.js';
import { InkApp, type UIMessage, type TextSegment, type PermissionPrompt } from './InkApp.js';
import { ThinkStream } from '../think-stream.js';
import type { PluginRegistry } from '../../../plugin.js';
import React from 'react';

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
  // Permission confirm state
  let pendingPermission: PermissionPrompt | null = null;
  let permissionResolve: ((value: boolean) => void) | null = null;

  function render(): void {
    if (!inkInstance) return;
    try {
      inkInstance.rerender(
        React.createElement(InkApp, {
          greeting,
          messages: [...messages],
          inputBuffer: '',
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
            }
          },
          pendingPermission,
          onPermissionResponse: (allowed: boolean) => {
            if (permissionResolve) {
              const r = permissionResolve;
              permissionResolve = null;
              pendingPermission = null;
              r(allowed);
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

    async onInit(registry: PluginRegistry): Promise<void> {
      registry.setConfirmCallback(async (req) => {
        return new Promise<boolean>((resolve) => {
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
        const initPromise = inkRender(
          React.createElement(InkApp, {
            greeting,
            messages: [],
            inputBuffer: '',
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
              }
            },
          }),
          { stdout: process.stdout, stdin: process.stdin, stderr: process.stderr, exitOnCtrlC: true, patchConsole: false },
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
      messages.push({ agentName: event.agentName, text: event.message, kind: 'status' });
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
        text: `🔧 ${event.toolName}(${JSON.stringify(event.args)})`,
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
  };
}

export const inkDisplayPlugin: DisplayPlugin = createPlugin();
