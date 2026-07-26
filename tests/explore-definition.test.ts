import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { EXPLORE_AGENT_DEF, EXPLORE_AGENT_NAME, isExploreAgent } from '../src/plugins/explore/explore-definition.js';

describe('EXPLORE_AGENT_DEF', () => {

  it('agent 名称为 explore', () => {
    assert.equal(EXPLORE_AGENT_DEF.name, EXPLORE_AGENT_NAME);
  });

  it('有 description', () => {
    assert.ok(typeof EXPLORE_AGENT_DEF.description === 'string');
    assert.ok(EXPLORE_AGENT_DEF.description.length > 10);
  });

  it('有 role', () => {
    assert.ok(typeof EXPLORE_AGENT_DEF.role === 'string');
    assert.ok(EXPLORE_AGENT_DEF.role.length > 5);
  });

  it('插件列表包含 fs、file-search、command、web', () => {
    const plugins = EXPLORE_AGENT_DEF.plugins ?? {};
    assert.ok('fs' in plugins);
    assert.ok('file-search' in plugins);
    assert.ok('command' in plugins);
    assert.ok('web' in plugins);
  });

  it('只有只读插件，没有协调器或任务类插件', () => {
    const plugins = EXPLORE_AGENT_DEF.plugins ?? {};
    const pluginNames = Object.keys(plugins);
    assert.ok(!pluginNames.includes('coordinator'));
    assert.ok(!pluginNames.includes('task-plan'));
    assert.ok(!pluginNames.includes('memory'));
    assert.ok(!pluginNames.includes('skills'));
    assert.ok(!pluginNames.includes('agent-slash'));
  });

  it('systemPrompt.withTools 为字符串且包含只读强调', () => {
    const tmpl = EXPLORE_AGENT_DEF.systemPrompt?.withTools;
    assert.ok(typeof tmpl === 'string');
    assert.ok(tmpl!.length > 100);
    assert.ok(tmpl!.includes('只读模式'));
    assert.ok(tmpl!.includes('{role}'));
    assert.ok(tmpl!.includes('{tool_list}'));
  });

  it('projectFiles 设为空数组以跳过 AGENT.md', () => {
    const files = EXPLORE_AGENT_DEF.systemPrompt?.projectFiles;
    assert.ok(Array.isArray(files));
    assert.equal(files!.length, 0);
  });

  it('enabled 默认为 undefined（表示启用）', () => {
    assert.equal(EXPLORE_AGENT_DEF.enabled, undefined);
  });
});

describe('isExploreAgent', () => {

  it('对 Explore agent 定义返回 true', () => {
    assert.equal(isExploreAgent(EXPLORE_AGENT_DEF), true);
  });

  it('对其他 agent 定义返回 false', () => {
    assert.equal(isExploreAgent({ name: 'dba', description: 'DBA', role: 'DBA' }), false);
    assert.equal(isExploreAgent({ name: 'explore', description: 'x', role: 'x' }), true);
  });
});
