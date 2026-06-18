import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DisplayManager } from '../src/display.js';
import { replDisplay } from '../src/plugins/display/repl.js';
import { resolveDisplayPlugin } from '../src/plugins/display/loader.js';

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
    onStatus(msg: string) { calls.push(`A:${msg}`); },
    prompt: async () => null,  // 无输入
  };

  const pluginB = {
    name: 'pluginB',
    onStatus(msg: string) { calls.push(`B:${msg}`); },
    onStreamChunk(msg: string) { calls.push(`B-stream:${msg}`); },
    onUserInput(input: string, src: string) { calls.push(`B-input:${src}:${input}`); },
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
    mgr.onStatus('hello');
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'A:hello');
    assert.equal(calls[1], 'B:hello');
  });

  it('onStreamChunk broadcasts to all plugins', () => {
    const mgr = new DisplayManager();
    mgr.addPlugin(pluginA);
    mgr.addPlugin(pluginB);
    mgr.onStreamChunk('data');
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

});
