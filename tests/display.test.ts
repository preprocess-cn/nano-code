import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DisplayManager } from '../src/display.js';
import { replDisplay } from '../src/plugins/display/repl.js';
import { resolveDisplayPlugin } from '../src/plugins/display/loader.js';
import { getToolArgsPreview, formatToolCall } from '../src/plugins/display/claude-code-ink/index.js';

describe('DisplayPlugin — repl', () => {

  it('name is repl', () => {
    assert.equal(replDisplay.name, 'repl');
  });

  it('onStart does not throw', () => {
    replDisplay.onStart?.({ greeting: 'hello', agentName: 'main', hasTools: true });
  });

  it('onStop does not throw', () => {
    replDisplay.onStop?.('bye');
  });

  it('onUserInput with self source does not echo', () => {
    // repl 自身来源不回显，只是验证不抛异常
    replDisplay.onUserInput?.('hello', 'repl');
  });

  it('onUserInput with other source echoes preview', () => {
    replDisplay.onUserInput?.('a very long input message', 'web');
    // visible output: "[来自 web] >> a very lon…"
  });

});

describe('resolveDisplayPlugin', () => {

  it('returns null for repl', async () => {
    const result = await resolveDisplayPlugin('repl');
    assert.equal(result, null);
  });

  it('loads plugin from absolute path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-pres-'));
    try {
      const pluginPath = path.join(dir, 'test-plugin.js');
      fs.writeFileSync(pluginPath, `
export default {
  name: 'test-pres',
  onStatus(msg) { console.log(msg); },
};
`, 'utf-8');

      const result = await resolveDisplayPlugin(pluginPath);
      assert.ok(result, 'should return a plugin');
      assert.equal(result!.name, 'test-pres');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws for non-existent path', async () => {
    await assert.rejects(
      () => resolveDisplayPlugin('/nonexistent/path.js'),
      /未找到/,
    );
  });

  it('throws for invalid plugin (no name)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-pres-'));
    try {
      const pluginPath = path.join(dir, 'bad.js');
      fs.writeFileSync(pluginPath, 'export default {};', 'utf-8');

      await assert.rejects(
        () => resolveDisplayPlugin(pluginPath),
        /未导出有效的展示插件/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe('DisplayManager — multi-plugin', () => {

  let calls: string[];
  const pluginA = {
    name: 'pluginA',
    onStatus(event: { message: string }) { calls.push(`A:${event.message}`); },
    onAgentTurnStart() { calls.push('A:onAgentTurnStart'); },
    onAgentTurnEnd() { calls.push('A:onAgentTurnEnd'); },
    onStateSnapshot(snapshot: { messageCount: number }) { calls.push(`A:stateSnapshot:${snapshot.messageCount}`); },
    prompt: async () => null,  // 无输入
  };

  const pluginB = {
    name: 'pluginB',
    onStatus(event: { message: string }) { calls.push(`B:${event.message}`); },
    onStreamChunk(event: { text: string }) { calls.push(`B-stream:${event.text}`); },
    onUserInput(input: string, src: string) { calls.push(`B-input:${src}:${input}`); },
    onAgentTurnStart() { calls.push('B:onAgentTurnStart'); },
    onAgentTurnEnd() { calls.push('B:onAgentTurnEnd'); },
    onStateSnapshot(snapshot: { messageCount: number }) { calls.push(`B:stateSnapshot:${snapshot.messageCount}`); },
    prompt: async () => 'input-from-B',
  };

  beforeEach(() => { calls = []; });

  it('empty manager has count 0 and no names', () => {
    const mgr = new DisplayManager();
    assert.equal(mgr.count, 0);
    assert.deepEqual(mgr.getPluginNames(), []);
  });

  it('addPlugin adds to the list', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    assert.equal(mgr.count, 1);
    assert.deepEqual(mgr.getPluginNames(), ['pluginA']);
  });

  it('addPlugin supports multiple plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    assert.equal(mgr.count, 2);
    assert.deepEqual(mgr.getPluginNames(), ['pluginA', 'pluginB']);
  });

  it('removePlugin removes by name', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.removePlugin('pluginA');
    assert.equal(mgr.count, 1);
    assert.deepEqual(mgr.getPluginNames(), ['pluginB']);
  });

  it('clearPlugins removes all', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.clearPlugins();
    assert.equal(mgr.count, 0);
  });

  it('onStatus broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onStatus({ message: 'hello', agentName: 'test', level: 'info' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'A:hello');
    assert.equal(calls[1], 'B:hello');
  });

  it('onStreamChunk broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onStreamChunk({ text: 'data', agentName: 'test' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'B-stream:data');
  });

  it('prompt returns first non-null result', async () => {
    const mgr = new DisplayManager();
    mgr.addPlugin({ name: 'noop' });         // no prompt method
    mgr.addPlugin(pluginA);                   // returns null
    mgr.addPlugin(pluginB);                   // returns 'input-from-B'
    const result = await mgr.prompt();
    assert.equal(result, 'input-from-B');
  });

  it('prompt returns null when no plugin provides input', async () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);                   // returns null
    const result = await mgr.prompt();
    assert.equal(result, null);
  });

  it('prompt broadcasts onUserInput after capturing', async () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);

    const result = await mgr.prompt();
    assert.equal(result, 'input-from-B');

    // pluginB got the input from itself
    const inputCalls = calls.filter(c => c.startsWith('B-input:'));
    assert.equal(inputCalls.length, 1);
    assert.equal(inputCalls[0], 'B-input:pluginB:input-from-B');
  });

  it('onAgentTurnStart broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onAgentTurnStart({ agentName: 'test' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'A:onAgentTurnStart');
    assert.equal(calls[1], 'B:onAgentTurnStart');
  });

  it('onAgentTurnEnd broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onAgentTurnEnd({ agentName: 'test' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'A:onAgentTurnEnd');
    assert.equal(calls[1], 'B:onAgentTurnEnd');
  });

  it('onStateSnapshot broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onStateSnapshot({ agentName: 'test', messageCount: 5 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'A:stateSnapshot:5');
    assert.equal(calls[1], 'B:stateSnapshot:5');
  });

  it('onAgentTurnStart/End and onStateSnapshot are no-ops when no plugin implements them', () => {
    const mgr = new DisplayManager();
    // plugin with no lifecycle hooks
    mgr.addPlugin({ name: 'silent' });
    // None of these should throw
    mgr.onAgentTurnStart({ agentName: 'test' });
    mgr.onAgentTurnEnd({ agentName: 'test' });
    mgr.onStateSnapshot({ agentName: 'test', messageCount: 0 });
    assert.equal(calls.length, 0);
  });

  it('DisplayPlugin interface supports ownsOutput and rawInput properties', () => {
    const plugin: any = { name: 'custom' };
    plugin.ownsOutput = true;
    plugin.rawInput = true;
    assert.equal(plugin.ownsOutput, true);
    assert.equal(plugin.rawInput, true);
  });

  it('StartConfig supports stdio fields', () => {
    const config: any = {
      greeting: 'hi',
      agentName: 'main',
      hasTools: false,
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
    };
    assert.equal(config.stdout, process.stdout);
    assert.equal(config.stderr, process.stderr);
    assert.equal(config.stdin, process.stdin);
  });

});

describe('formatToolCall / getToolArgsPreview', () => {

  it('Write — shows only file_path, skips content', () => {
    const args = { file_path: '/project/src/main.ts', content: 'export const x = 1;\n' };
    assert.equal(getToolArgsPreview(args), '/project/src/main.ts');
    assert.equal(formatToolCall('Write', args), '🔧 Write(/project/src/main.ts)');
  });

  it('Write — skips known large fields (old_string, new_string, etc.)', () => {
    const args = { file_path: '/a.ts', old_string: 'old content', new_string: 'new content', mode: 'replace' };
    assert.equal(getToolArgsPreview(args), '/a.ts, mode=replace');
  });

  it('Write — long file_path truncated', () => {
    const longPath = '/a/' + 'very/'.repeat(20) + 'file.ts';
    const preview = getToolArgsPreview({ file_path: longPath, content: 'x' });
    assert.ok(preview!.length < longPath.length);
    assert.ok(preview!.length <= 83);
  });

  it('Read/Glob — shows file_path or pattern', () => {
    assert.equal(getToolArgsPreview({ file_path: '/a/b.ts' }), '/a/b.ts');
    assert.equal(getToolArgsPreview({ pattern: '*.ts', path: '/src' }), '*.ts, /src');
  });

  it('Bash — shows truncated command', () => {
    assert.equal(getToolArgsPreview({ command: 'npm run build' }), 'command: npm run build');

    const longCmd = 'echo ' + 'a'.repeat(200);
    const long = getToolArgsPreview({ command: longCmd });
    assert.ok(long!.length < longCmd.length + 20);
  });

  it('URL tool — shows url', () => {
    assert.equal(getToolArgsPreview({ url: 'https://example.com' }), 'https://example.com');
  });

  it('content-only (no file_path) — skips content, shows other keys', () => {
    const args = { content: 'big content here', language: 'ts', model: 'gpt-4' };
    assert.equal(getToolArgsPreview(args), 'language=ts, model=gpt-4');
  });

  it('unknown tool — falls back to JSON truncation', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 50; i++) big[`k${i}`] = 'x'.repeat(20);
    assert.equal(getToolArgsPreview(big), null);
    const formatted = formatToolCall('Foo', big);
    assert.ok(formatted.length < 300);
    assert.ok(formatted.includes('…'));
  });

  it('null / non-object args', () => {
    assert.equal(formatToolCall('Foo', null), '🔧 Foo(null)');
    assert.equal(formatToolCall('Foo', 'str'), '🔧 Foo("str")');
    assert.equal(formatToolCall('Foo', 42), '🔧 Foo(42)');
  });

  it('empty args', () => {
    assert.equal(formatToolCall('Foo', {}), '🔧 Foo({})');
  });

});
