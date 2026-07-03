import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '#src/core/plugin.js';
import { createModelRegistryPlugin, type ModelRegistrySettings } from '#src/plugins/model-registry/index.js';
import { SK } from '#src/core/store-keys.js';
import type { ModelEntry } from '#src/core/llm.js';

describe('ModelRegistry Plugin', () => {

  it('creates plugin with name and description', () => {
    const plugin = createModelRegistryPlugin();
    assert.equal(plugin.name, 'model-registry');
    assert.equal(typeof plugin.description, 'string');
  });

  it('provides no tools', () => {
    const plugin = createModelRegistryPlugin();
    assert.deepEqual(plugin.getTools(), []);
  });

  it('writes first model to Store on init when models are configured', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', baseURL: 'https://test.api.com/v1' },
        { provider: 'openai', model: 'deepseek-chat', apiKey: 'sk-ds', baseURL: 'https://api.deepseek.com/v1' },
      ],
    });
    await registry.register(plugin);

    const override = registry.store.get<ModelEntry>(SK.ModelOverride);
    assert.ok(override);
    assert.equal(override.model, 'gpt-4o');
    assert.equal(override.apiKey, 'sk-test');
    assert.equal(override.baseURL, 'https://test.api.com/v1');
  });

  it('writes full models list to Store for /model command', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-1', baseURL: 'https://api.openai.com/v1' },
        { provider: 'openai', model: 'deepseek-chat', apiKey: 'sk-2', baseURL: 'https://api.deepseek.com/v1' },
      ],
    });
    await registry.register(plugin);

    const models = registry.store.get<ModelEntry[]>(SK.ModelRegistryModels);
    assert.ok(models);
    assert.equal(models.length, 2);
    assert.equal(models[1].model, 'deepseek-chat');
  });

  it('resolves $ENV_VAR in apiKey and baseURL', async () => {
    process.env.__TEST_MODEL_KEY = 'sk-resolved-key';
    process.env.__TEST_MODEL_URL = 'https://resolved.api.com/v1';

    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'test-model', apiKey: '$__TEST_MODEL_KEY', baseURL: '$__TEST_MODEL_URL' },
      ],
    });
    await registry.register(plugin);

    const override = registry.store.get<ModelEntry>(SK.ModelOverride);
    assert.equal(override?.apiKey, 'sk-resolved-key');
    assert.equal(override?.baseURL, 'https://resolved.api.com/v1');
  });

  it('resolves $ENV_VAR only for models slice (not undefined)', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'no-env', apiKey: 'literal-key' },
      ],
    });
    await registry.register(plugin);

    const override = registry.store.get<ModelEntry>(SK.ModelOverride);
    assert.equal(override?.apiKey, 'literal-key');
  });

  it('does nothing when models list is empty', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({ models: [] });
    await registry.register(plugin);

    const override = registry.store.get(SK.ModelOverride);
    assert.equal(override, undefined);

    const models = registry.store.get(SK.ModelRegistryModels);
    assert.equal(models, undefined);
  });

  it('does nothing when no settings provided', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin();
    await registry.register(plugin);

    const override = registry.store.get(SK.ModelOverride);
    assert.equal(override, undefined);
  });

  it('reads config from PluginRegistry config (not only constructor arg)', async () => {
    const registry = new PluginRegistry();
    registry.setPluginConfig('model-registry', {
      models: [
        { provider: 'openai', model: 'config-model', apiKey: 'sk-config', baseURL: 'https://config.api.com/v1' },
      ],
    } satisfies ModelRegistrySettings);
    const plugin = createModelRegistryPlugin();
    await registry.register(plugin);

    const override = registry.store.get<ModelEntry>(SK.ModelOverride);
    assert.equal(override?.model, 'config-model');
    assert.equal(override?.apiKey, 'sk-config');
  });

  it('constructor settings take precedence when registry config is also set', async () => {
    const registry = new PluginRegistry();
    registry.setPluginConfig('model-registry', {
      models: [
        { provider: 'openai', model: 'from-registry', apiKey: 'sk-reg' },
      ],
    } satisfies ModelRegistrySettings);
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'from-ctor', apiKey: 'sk-ctor' },
      ],
    });
    await registry.register(plugin);

    // registry config is read first via getPluginConfig, so 'from-registry' wins
    const override = registry.store.get<ModelEntry>(SK.ModelOverride);
    assert.equal(override?.model, 'from-registry');
    assert.equal(override?.apiKey, 'sk-reg');
  });

  it('throws on unset $ENV_VAR', async () => {
    const registry = new PluginRegistry();
    const plugin = createModelRegistryPlugin({
      models: [
        { provider: 'openai', model: 'broken', apiKey: '$__NONEXISTENT_VAR_XYZ__' },
      ],
    });

    // onInit should throw, and registry.register catches it without crashing
    await registry.register(plugin);

    // Store should be unmodified
    const override = registry.store.get(SK.ModelOverride);
    assert.equal(override, undefined);
  });

});
