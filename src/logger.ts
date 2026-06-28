/**
 * 日志插件体系 — 可同时注册多个后端（stderr、文件等），与 PluginRegistry 解耦。
 *
 * LogPlugin 接口类似 DisplayPlugin：每个后端实现 onLog hook，
 * LogManager 统一调度到所有已注册插件。
 * 默认注册 stderr 后端，开箱即用。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  args?: unknown[];
  error?: Error;
}

export interface LogPlugin {
  name: string;
  /** 所有级别的日志条目经过此 hook。同 DisplayPlugin 的 onEvent 命名惯例。 */
  onLog?(entry: LogEntry): void;
}

export class LogManager {
  private plugins: Map<string, LogPlugin> = new Map();

  register(plugin: LogPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  private _log(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
    if (this.plugins.size === 0) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
    };

    if (args.length > 0) {
      const last = args[args.length - 1];
      if (last instanceof Error) {
        entry.error = last;
        args = args.slice(0, -1);
      }
      if (args.length > 0) {
        entry.args = args;
      }
    }

    for (const plugin of this.plugins.values()) {
      plugin.onLog?.(entry);
    }
  }

  debug(module: string, message: string, ...args: unknown[]): void {
    this._log('debug', module, message, ...args);
  }

  info(module: string, message: string, ...args: unknown[]): void {
    this._log('info', module, message, ...args);
  }

  warn(module: string, message: string, ...args: unknown[]): void {
    this._log('warn', module, message, ...args);
  }

  error(module: string, message: string, ...args: unknown[]): void {
    this._log('error', module, message, ...args);
  }
}

/** 默认日志后端 — 格式化输出到 stderr。格式：[timestamp] [LEVEL] [module] message */
export class StderrLogPlugin implements LogPlugin {
  name = 'stderr';

  onLog(entry: LogEntry): void {
    const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;
    if (entry.error) {
      process.stderr.write(`${line}\n${entry.error.stack}\n`);
    } else {
      process.stderr.write(`${line}\n`);
    }
  }
}

/** 全局 LogManager 单例，模块加载时自动注册默认 stderr 后端 */
export const logManager = new LogManager();
logManager.register(new StderrLogPlugin());
