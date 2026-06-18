import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createAgentToolPlugin } from '../src/agent-tool.js';
import { PluginRegistry } from '../src/plugin.js';
import { AgentDefinition } from '../src/agent-loader.js';
import { LLMClient } from '../src/llm.js';

function mockLLMClient() {
  return {
    model: 'test-model',
    temperature: 0,
  } as unknown as LLMClient;
}

describe('createAgentToolPlugin', () => {

  const baseDef: AgentDefinition = {
    name: 'test-agent',
    description: 'A test agent for unit testing',
    role: 'You are a test agent',
  };

  it('returns a plugin with the correct name', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    assert.equal(plugin.name, 'agent:test-agent');
    assert.equal(plugin.description, 'A test agent for unit testing');
  });

  it('exposes a single tool named agent-<name>', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const tools = plugin.getTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'agent-test-agent');
  });

  it('tool has query parameter', () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const tools = plugin.getTools();
    const params = tools[0].function.parameters;
    assert.ok(params.properties.query, 'should have query property');
    assert.equal(params.required[0], 'query');
  });

  it('can be registered in a PluginRegistry', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const registry = new PluginRegistry();
    await registry.register(plugin);

    const schemas = registry.getAllSchemas();
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].function.name, 'agent-test-agent');
  });

  it('returns error when query is empty', async () => {
    const plugin = createAgentToolPlugin(baseDef, mockLLMClient());
    const result = await plugin.execute('agent-test-agent', {}, {
      skipPermission: true,
      cwd: process.cwd(),
      defaultTimeout: 30000,
      sideEffect: false,
    });

    assert.equal(result.status, 'error');
    assert.ok(result.message?.includes('query'));
  });

});
