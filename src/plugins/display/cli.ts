import type { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, MessageLevel } from '#src/display.js';
import type { PluginRegistry } from '#src/core/plugin.js';

/**
 * 非交互式 CLI 展示插件 — 用于管道模式或无展示层的兜底。
 *
 * stdout → AI 响应文本（可被管道捕获）
 * stderr → 状态/警告/错误消息
 */
export const cliDisplay: DisplayPlugin = {
  name: 'cli',
  ownsOutput: true,
  rawInput: false,

  async onInit(_registry: PluginRegistry): Promise<void> {},

  onStart(_config: StartConfig): void {},

  onStop(message: string): void {
    process.stderr.write('\n' + message + '\n');
  },

  prompt(): Promise<string | null> {
    return Promise.resolve(null);
  },

  onUserInput(_input: string, _sourcePlugin: string): void {},

  onStatus(event: StatusEvent): void {
    if (event.level === 'status' && event.message === 'thinking') {
      process.stderr.write('[思考中...]');
      return;
    }
    if (event.level === 'status' && event.message === 'end') {
      process.stderr.write('\n');
      return;
    }
    const out = (event.level === 'error' || event.level === 'warn') ? process.stderr : process.stdout;
    out.write(formatLevel(event.level) + event.message + '\n');
  },

  onStreamChunk(event: StreamEvent): void {
    if (!event.text) return;
    process.stdout.write(event.text);
  },

  onToolCall(event: ToolCallEvent): void {
    process.stderr.write(`[调用] ${event.toolName}\n`);
  },

  onToolResult(event: ToolResultEvent): void {
    switch (event.status) {
      case 'rejected_by_user':
        process.stderr.write('[用户拒绝]\n');
        break;
      case 'error':
        process.stderr.write(`[失败] ${event.message || '未知错误'}\n`);
        break;
      case 'success':
        process.stderr.write('[成功]\n');
        break;
    }
  },

  onError(event: ErrorEvent): void {
    process.stderr.write(`[错误] ${event.message}\n`);
    if (event.stack) process.stderr.write(event.stack + '\n');
  },

  onDebug(event: DebugEvent): void {
    process.stderr.write(`[调试] ${event.data}\n`);
  },
};

function formatLevel(level: MessageLevel): string {
  switch (level) {
    case 'warn': return '\x1b[33m⚠\x1b[0m ';
    case 'error': return '\x1b[31m✗\x1b[0m ';
    case 'success': return '\x1b[32m✓\x1b[0m ';
    default: return '';
  }
}

function getLevelPrefix(level: MessageLevel): string {
  switch (level) {
    case 'warn': return '\x1b[33m[警告]\x1b[0m ';
    case 'error': return '\x1b[31m[错误]\x1b[0m ';
    case 'success': return '\x1b[32m[成功]\x1b[0m ';
    default: return '';
  }
}
