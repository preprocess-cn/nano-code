import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { _mergeConfigs, getPluginConfig, validateConfigObject } from '../src/core/config.js';

describe('Config — merge', () => {

  it('returns defaults when both configs are null', () => {
    const cfg = _mergeConfigs(null, null);
    assert.equal(cfg.core.model, undefined);
    assert.equal(cfg.core.temperature, undefined);
    assert.equal(cfg.core.maxTokens, 128000);
    assert.equal(cfg.core.defaultTimeout, 120000);
    assert.deepEqual(cfg.plugins, {});
    assert.equal(cfg.agent, undefined);
  });

  it('global config overrides defaults', () => {
    const cfg = _mergeConfigs(
      { core: { model: 'deepseek-chat', temperature: 0.3 } },
      null,
    );
    assert.equal(cfg.core.model, 'deepseek-chat');
    assert.equal(cfg.core.temperature, 0.3);
    // Unset fields stay at default
    assert.equal(cfg.core.maxTokens, 128000);
    assert.equal(cfg.core.defaultTimeout, 120000);
  });

  it('project config overrides global', () => {
    const cfg = _mergeConfigs(
      { core: { model: 'global-model' } },
      { core: { model: 'project-model' } },
    );
    assert.equal(cfg.core.model, 'project-model');
  });

  it('project agent config overrides global agent', () => {
    const cfg = _mergeConfigs(
      { agent: { role: 'global-role', greeting: 'global-hi' } },
      { agent: { role: 'project-role' } },
    );
    assert.equal(cfg.agent!.role, 'project-role');
    // greeting not overridden by project, falls back to global
    assert.equal(cfg.agent!.greeting, 'global-hi');
  });

  it('partial core values do not wipe unset fields', () => {
    const cfg = _mergeConfigs(
      null,
      { core: { model: 'custom' } },
    );
    assert.equal(cfg.core.model, 'custom');
    assert.equal(cfg.core.temperature, undefined);   // 无默认值，由 LLMClient 兜底
    assert.equal(cfg.core.maxTokens, 128000);  // default
    assert.equal(cfg.core.defaultTimeout, 120000);   // default
  });

  it('non-object core override is ignored', () => {
    const cfg = _mergeConfigs(null, { core: 'invalid' } as any);
    // Falls back to default (model/temperature 无默认，由 LLMClient 兜底)
    assert.equal(cfg.core.model, undefined);
    assert.equal(cfg.core.temperature, undefined);
  });

  it('merges plugins from global and project', () => {
    const cfg = _mergeConfigs(
      {
        plugins: {
          fs: { enabled: true, settings: { maxDepth: 3 } },
          command: { enabled: false },
        },
      },
      {
        plugins: {
          fs: { settings: { extra: true } },
          token: { enabled: true },
        },
      },
    );
    // fs from global, settings deep-merged with project
    assert.equal(cfg.plugins.fs?.enabled, true);
    assert.deepEqual(cfg.plugins.fs?.settings, { maxDepth: 3, extra: true });
    // command from global only
    assert.equal(cfg.plugins.command?.enabled, false);
    // token from project only
    assert.equal(cfg.plugins.token?.enabled, true);
  });

  it('invalid plugin config (non-object) is skipped with warning', () => {
    // Should not throw, should skip the entry
    const cfg = _mergeConfigs(null, {
      plugins: { bad: 'string' as any },
    });
    assert.deepEqual(cfg.plugins, {});
  });

  it('unknown top-level keys do not crash', () => {
    const cfg = _mergeConfigs(null, {
      unknownKey: { foo: 1 },
    } as any);
    // Should still produce a valid config
    assert.equal(cfg.core.model, undefined);
  });

});

describe('Config — getPluginConfig', () => {

  it('returns settings for a configured plugin', () => {
    const cfg = _mergeConfigs(
      null,
      { plugins: { myPlugin: { settings: { key: 'val' } } } },
    );
    assert.deepEqual(getPluginConfig(cfg, 'myPlugin'), { key: 'val' });
  });

  it('returns empty object for unconfigured plugin', () => {
    const cfg = _mergeConfigs(null, null);
    assert.deepEqual(getPluginConfig(cfg, 'nonexistent'), {});
  });

  it('returns empty object when plugin has no settings', () => {
    const cfg = _mergeConfigs(
      null,
      { plugins: { myPlugin: { enabled: true } } },
    );
    assert.deepEqual(getPluginConfig(cfg, 'myPlugin'), {});
  });

});

describe('Config — schema validation', () => {

  it('passes on a valid config with no warnings', () => {
    const warnings = validateConfigObject({
      core: { model: 'gpt-4', temperature: 0.5, maxTokens: 2048, defaultTimeout: 60000 },
      plugins: {
        fs: { type: 'builtin', enabled: true },
        mcpServer: { type: 'mcp', transport: 'stdio', command: 'node', args: ['server.js'] },
      },
      agent: { role: 'assistant', greeting: 'hi' },
    });
    assert.equal(warnings.length, 0);
  });

  it('passes on an empty config', () => {
    const warnings = validateConfigObject({});
    assert.equal(warnings.length, 0);
  });

  it('warns about unknown top-level keys', () => {
    const warnings = validateConfigObject({
      unknownKey: {},
      core: { model: 'gpt-4' },
    });
    assert.ok(warnings.some(w => w.path === 'unknownKey'));
  });

  it('warns about unknown core keys', () => {
    const warnings = validateConfigObject({
      core: { model: 'gpt-4', temprature: 0.5, maxToken: 1000 },
    });
    assert.ok(warnings.some(w => w.path === 'core.temprature'));
    assert.ok(warnings.some(w => w.path === 'core.maxToken'));
    // model is valid, no warning
    assert.equal(warnings.filter(w => w.path.startsWith('core.')).length, 2);
  });

  it('warns about temperature out of range', () => {
    const w1 = validateConfigObject({ core: { temperature: 3 } });
    assert.ok(w1.some(w => w.path === 'core.temperature'));

    const w2 = validateConfigObject({ core: { temperature: -0.1 } });
    assert.ok(w2.some(w => w.path === 'core.temperature'));

    const w3 = validateConfigObject({ core: { temperature: 0 } });
    assert.equal(w3.filter(w => w.path === 'core.temperature').length, 0);

    const w4 = validateConfigObject({ core: { temperature: 2 } });
    assert.equal(w4.filter(w => w.path === 'core.temperature').length, 0);
  });

  it('warns about non-positive maxTokens', () => {
    const w1 = validateConfigObject({ core: { maxTokens: 0 } });
    assert.ok(w1.some(w => w.path === 'core.maxTokens'));

    const w2 = validateConfigObject({ core: { maxTokens: -1 } });
    assert.ok(w2.some(w => w.path === 'core.maxTokens'));

    const w3 = validateConfigObject({ core: { maxTokens: 100 } });
    assert.equal(w3.filter(w => w.path === 'core.maxTokens').length, 0);
  });

  it('warns about non-positive defaultTimeout', () => {
    const w1 = validateConfigObject({ core: { defaultTimeout: 0 } });
    assert.ok(w1.some(w => w.path === 'core.defaultTimeout'));
  });

  it('warns about wrong types for core fields', () => {
    const w1 = validateConfigObject({ core: { model: 123 } });
    assert.ok(w1.some(w => w.path === 'core.model'));

    const w2 = validateConfigObject({ core: { temperature: 'hot' } });
    assert.ok(w2.some(w => w.path === 'core.temperature'));
  });

  it('warns about unknown agent keys', () => {
    const warnings = validateConfigObject({
      agent: { role: 'helper', greeting: 'hi', unknownField: 'x' },
    });
    assert.ok(warnings.some(w => w.path === 'agent.unknownField'));
  });

  it('warns about wrong types for agent fields', () => {
    const w1 = validateConfigObject({ agent: { role: 42 } });
    assert.ok(w1.some(w => w.path === 'agent.role'));

    const w2 = validateConfigObject({ agent: { greeting: true } });
    assert.ok(w2.some(w => w.path === 'agent.greeting'));
  });

  it('warns about unknown plugin entry keys', () => {
    const warnings = validateConfigObject({
      plugins: { fs: { type: 'builtin', enabled: true, unknownSetting: 'x' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.fs.unknownSetting'));
  });

  it('warns about invalid plugin type', () => {
    const warnings = validateConfigObject({
      plugins: { myPlugin: { type: 'invalid-type' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.myPlugin.type'));
  });

  it('warns about invalid transport', () => {
    const warnings = validateConfigObject({
      plugins: { mcp1: { type: 'mcp', transport: 'websocket' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.mcp1.transport'));
  });

  it('warns when enabled is not boolean', () => {
    const warnings = validateConfigObject({
      plugins: { fs: { enabled: 'true' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.fs.enabled'));
  });

  it('warns when sideEffect is not boolean', () => {
    const warnings = validateConfigObject({
      plugins: { fs: { sideEffect: 'false' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.fs.sideEffect'));
  });

  it('accepts sideEffect as a known key', () => {
    const w1 = validateConfigObject({
      plugins: { fs: { sideEffect: true } },
    });
    assert.equal(w1.filter(w => w.path === 'plugins.fs.sideEffect').length, 0);

    const w2 = validateConfigObject({
      plugins: { fs: { sideEffect: false } },
    });
    assert.equal(w2.filter(w => w.path === 'plugins.fs.sideEffect').length, 0);
  });

  it('warns about non-positive initTimeout', () => {
    const w1 = validateConfigObject({
      plugins: { mcp1: { initTimeout: 0 } },
    });
    assert.ok(w1.some(w => w.path === 'plugins.mcp1.initTimeout'));

    const w2 = validateConfigObject({
      plugins: { mcp1: { initTimeout: -100 } },
    });
    assert.ok(w2.some(w => w.path === 'plugins.mcp1.initTimeout'));
  });

  it('warns when MCP stdio plugin has no command', () => {
    const warnings = validateConfigObject({
      plugins: { mcp1: { type: 'mcp', transport: 'stdio' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.mcp1.command'));
  });

  it('warns when MCP http plugin has no url', () => {
    const warnings = validateConfigObject({
      plugins: { mcp1: { type: 'mcp', transport: 'http' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.mcp1.url'));
  });

  it('does not warn on MCP http with url present', () => {
    const warnings = validateConfigObject({
      plugins: { mcp1: { type: 'mcp', transport: 'http', url: 'http://localhost:8080' } },
    });
    assert.equal(warnings.filter(w => w.path === 'plugins.mcp1.url').length, 0);
  });

  it('warns when npm plugin has no spec', () => {
    const warnings = validateConfigObject({
      plugins: { myNpm: { type: 'npm' } },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.myNpm.spec'));
  });

  it('does not warn on npm plugin with spec', () => {
    const warnings = validateConfigObject({
      plugins: { myNpm: { type: 'npm', spec: '@scope/my-plugin' } },
    });
    assert.equal(warnings.filter(w => w.path.startsWith('plugins.myNpm')).length, 0);
  });

  it('warns when plugin config is not an object', () => {
    const warnings = validateConfigObject({
      plugins: { badPlugin: 'string-value' },
    });
    assert.ok(warnings.some(w => w.path === 'plugins.badPlugin'));
  });

  it('returns multiple warnings for a deeply broken config', () => {
    const warnings = validateConfigObject({
      core: { model: 'gpt-4', temprature: 1 },
      plugins: {
        mcp1: { type: 'mcp', transport: 'stdio' },
        fs: { enabled: 'yes', unknownField: 1 },
      },
      agent: { role: 123 },
    });
    // Should catch: core.temprature (unknown), plugins.mcp1.command (missing),
    // plugins.fs.enabled (wrong type), plugins.fs.unknownField (unknown), agent.role (wrong type)
    assert.ok(warnings.length >= 4);
  });

});
