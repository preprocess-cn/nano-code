import { appendFileSync } from 'fs';

const DEBUG = process.env.NANO_CODE_DEBUG === '1' || process.env.NANO_CODE_DEBUG === 'true';

export function isDebugEnabled(): boolean {
  return DEBUG;
}

/** 开发调试日志。设置 NANO_CODE_DEBUG=1 环境变量后，输出到 /tmp/nano-code-debug.log */
export function debugLog(message: string): void {
  if (DEBUG) {
    appendFileSync('/tmp/nano-code-debug.log', `[${Date.now()}] ${message}\n`);
  }
}
