import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from '#src/core/llm.js';

const SESSION_FILE = '.nano-code-session.json';

export interface SessionData {
  messages: ChatMessage[];
  updatedAt: string;
}

/**
 * Save the current conversation history to `<cwd>/.nano-code-session.json`.
 * Silently ignores write errors (permission denied, read-only fs, etc.).
 */
export function saveSession(cwd: string, messages: ChatMessage[]): void {
  try {
    const data: SessionData = {
      messages,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(cwd, SESSION_FILE), JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // best-effort: don't crash the app if session can't be saved
  }
}

/**
 * Load conversation history from `<cwd>/.nano-code-session.json`.
 * Returns `null` if the file doesn't exist or is corrupted.
 */
export function loadSession(cwd: string): SessionData | null {
  try {
    const raw = fs.readFileSync(path.join(cwd, SESSION_FILE), 'utf-8');
    const data = JSON.parse(raw) as SessionData;
    if (!Array.isArray(data.messages)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Check whether a session file exists for the given directory.
 */
export function hasSession(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, SESSION_FILE));
}
