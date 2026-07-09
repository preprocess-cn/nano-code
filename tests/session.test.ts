import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { saveSession, loadSession, hasSession } from '../src/bootstrap/session.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nc-session-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
}

describe('Session — save / load', () => {

  it('save then load returns the same messages', () => {
    const cwd = tmpDir();
    try {
      const messages = [
        { role: 'user' as const, content: 'hello' },
        { role: 'assistant' as const, content: 'hi there' },
      ];
      saveSession(cwd, messages);
      assert.ok(hasSession(cwd));
      const loaded = loadSession(cwd);
      assert.ok(loaded);
      assert.equal(loaded!.messages.length, 2);
      assert.equal(loaded!.messages[0].content, 'hello');
      assert.equal(loaded!.messages[1].content, 'hi there');
    } finally {
      rmDir(cwd);
    }
  });

  it('loadSession returns null when no session file', () => {
    const cwd = tmpDir();
    try {
      assert.equal(loadSession(cwd), null);
      assert.equal(hasSession(cwd), false);
    } finally {
      rmDir(cwd);
    }
  });

  it('loadSession returns null for corrupted file', () => {
    const cwd = tmpDir();
    try {
      fs.writeFileSync(path.join(cwd, '.nano-code-session.json'), 'not json', 'utf-8');
      assert.equal(loadSession(cwd), null);
    } finally {
      rmDir(cwd);
    }
  });

  it('loadSession returns null for invalid structure', () => {
    const cwd = tmpDir();
    try {
      fs.writeFileSync(
        path.join(cwd, '.nano-code-session.json'),
        JSON.stringify({ not: 'messages' }),
        'utf-8',
      );
      assert.equal(loadSession(cwd), null);
    } finally {
      rmDir(cwd);
    }
  });

  it('saves tool_calls and tool_call_id fields', () => {
    const cwd = tmpDir();
    try {
      const messages = [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'test', arguments: '{}' as const } }] as any,
        },
        { role: 'tool' as const, tool_call_id: 'call_1', name: 'test', content: 'done' },
      ];
      saveSession(cwd, messages);
      const loaded = loadSession(cwd);
      assert.ok(loaded);
      assert.equal(loaded!.messages.length, 2);
      assert.ok(loaded!.messages[0].tool_calls);
      assert.equal(loaded!.messages[0].tool_calls![0].id, 'call_1');
      assert.equal(loaded!.messages[1].tool_call_id, 'call_1');
    } finally {
      rmDir(cwd);
    }
  });

  it('does not throw on unwritable directory', () => {
    saveSession('/dev/null/nonexistent', []);
  });

});
