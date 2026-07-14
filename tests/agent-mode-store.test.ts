import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PluginRegistry } from '../src/core/plugin.js';
import { SK, type AgentModeInfo } from '../src/store-keys.js';

describe('AgentMode via Store (Store 接口协议验证)', () => {

  test('default AgentMode is undefined', () => {
    const registry = new PluginRegistry();
    const mode = registry.store.get<AgentModeInfo>(SK.AgentMode);
    assert.equal(mode, undefined);
  });

  test('AgentMode round-trip through store', () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentMode, { name: 'dba', description: '数据库专家' });

    const agentMode = registry.store.get<AgentModeInfo>(SK.AgentMode);
    assert.ok(agentMode !== undefined);
    assert.equal(agentMode!.name, 'dba');
    assert.equal(agentMode!.description, '数据库专家');
  });

  test('AgentMode name is used for display prefix', () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentMode, { name: 'reviewer', description: '代码审查' });

    const agentMode = registry.store.get<AgentModeInfo>(SK.AgentMode);
    const prefix = agentMode ? `[${agentMode.name}]` : '';
    assert.equal(prefix, '[reviewer]');
  });

  test('AgentMode name is readable by display plugin', () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentMode, { name: 'helper', description: '助手' });

    const activeName = registry.store.get<AgentModeInfo>(SK.AgentMode)?.name;
    assert.equal(activeName, 'helper');
  });

  test('resetting to main mode clears AgentMode in Store', () => {
    const registry = new PluginRegistry();
    // Switch to agent
    registry.store.set(SK.AgentMode, { name: 'dba', description: '数据库专家' });
    assert.ok(registry.store.get<AgentModeInfo>(SK.AgentMode) !== undefined);

    // Reset to main
    registry.store.set(SK.AgentMode, undefined);
    assert.equal(registry.store.get<AgentModeInfo>(SK.AgentMode), undefined);
  });

  test('store.get/set typed round-trip with AgentMode', () => {
    const registry = new PluginRegistry();
    registry.store.set(SK.AgentMode, { name: 'test', description: 'test agent' });
    const result = registry.store.get<AgentModeInfo>(SK.AgentMode);
    assert.deepEqual(result, { name: 'test', description: 'test agent' });
  });

});
