/**
 * 结构化日志模块。
 *
 * 日志输出到 stderr，不干扰 stdout 的管道输出。
 * 格式：[2026-06-28T12:00:00.000Z] [level] [module] message
 */

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerOptions {
  /** 日志级别，默认 info */
  level?: LogLevel;
  /** 可选日志文件路径（追加模式） */
  file?: string;
}

export class Logger {
  private level: LogLevel;
  private fileHandle?: Promise<void>;

  constructor(private name: string, options?: LoggerOptions) {
    this.level = options?.level ?? 'info';
    if (options?.file) {
      this.fileHandle = this.initFile(options.file);
    }
  }

  private async initFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs');
      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      const origEmit = this.emit.bind(this);
      this.emit = (level, module, msg, ...args) => {
        origEmit(level, module, msg, ...args);
        const line = this.format(level, module, msg, args) + '\n';
        stream.write(line);
      };
    } catch {
      // 文件写入失败静默回退到 stderr
    }
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private format(level: LogLevel, module: string, message: string, args: unknown[]): string {
    const time = this.timestamp();
    const base = `[${time}] [${level.toUpperCase()}] [${module}] ${message}`;
    if (args.length === 0) return base;
    // 第一个参数如果是 Error，附加 stack
    if (args[0] instanceof Error) {
      const err = args[0];
      return base + `\n${err.stack ?? err.message}`;
    }
    return base + ' ' + args.map(a => JSON.stringify(a)).join(' ');
  }

  private emit(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
    if (LOG_PRIORITY[level] < LOG_PRIORITY[this.level]) return;

    const line = this.format(level, module, message, args);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stderr.write(line + '\n');
    }
  }

  debug(message: string, ...args: unknown[]): void { this.emit('debug', this.name, message, ...args); }
  info(message: string, ...args: unknown[]): void { this.emit('info', this.name, message, ...args); }
  warn(message: string, ...args: unknown[]): void { this.emit('warn', this.name, message, ...args); }
  error(message: string, ...args: unknown[]): void { this.emit('error', this.name, message, ...args); }

  child(name: string): Logger {
    return new Logger(`${this.name}:${name}`, { level: this.level });
  }
}
