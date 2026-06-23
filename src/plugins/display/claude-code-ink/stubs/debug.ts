import type { DebugLogLevel } from './types.js';

export function logForDebugging(message: string, level?: DebugLogLevel): void {
  // no-op in nano-code
}

export function shouldShowDebugMessage(_filter: string): boolean {
  return false;
}
