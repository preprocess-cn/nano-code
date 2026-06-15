import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { _mergeConfigs, getPluginConfig, resetConfigCache } from '../src/config.js';

describe('Config — merge', () => {

  it('returns defaults when both configs are null', () => {
    const cfg = _mergeConfigs(null, null);
    assert.equal(cfg.core.model, 'gpt-4o');
    assert.equal(cfg.core.temperature, 0);
    assert.equal(cfg.core.maxTokens, 4096);
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
    assert.equal(cfg.core.maxTokens, 4096);
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
    assert.equal(cfg.core.temperature, 0);   // default
    assert.equal(cfg.core.maxTokens, 4096);   // default
    assert.equal(cfg.core.defaultTimeout, 120000); // default
  });

  it('non-object core override is ignored', () => {
    const cfg = _mergeConfigs(null, { core: 'invalid' } as any);
    // Falls back to default
    assert.equal(cfg.core.model, 'gpt-4o');
    assert.equal(cfg.core.temperature, 0);
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
    assert.equal(cfg.core.model, 'gpt-4o');
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

describe('Config — cache', () => {

  it('resetConfigCache clears the internal cache', () => {
    // Test that calling resetConfigCache doesn't throw
    resetConfigCache();
    // Call twice to verify no crash
    resetConfigCache();
  });

});
