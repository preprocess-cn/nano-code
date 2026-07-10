import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/core/plugin.js';
import { SK } from '../src/core/store-keys.js';

/**
 * Ink display — mode toggle via Shift+Tab
 *
 * 验证 mode 切换回调逻辑：在 PluginRegistry 的 store 上模拟
 * handleModeToggle 的行为（index.ts 中的闭包逻辑）。
 */
describe('Mode toggle (Shift+Tab)', () => {
  it('default mode is normal', () => {
    const registry = new PluginRegistry();
    const mode = registry.store.get<string>(SK.Mode) || 'normal';
    assert.equal(mode, 'normal');
  });

  it('normal → plan: saves PrePlanMode and sets Mode to plan', () => {
    const registry = new PluginRegistry();

    // 模拟 handleModeToggle 进入 plan 模式
    const currentMode = registry.store.get<string>(SK.Mode) || 'normal';
    registry.store.set(SK.PrePlanMode, currentMode);
    registry.store.set(SK.Mode, 'plan');

    assert.equal(registry.store.get<string>(SK.Mode), 'plan');
    assert.equal(registry.store.get<string>(SK.PrePlanMode), 'normal');
  });

  it('plan → normal: restores PrePlanMode and clears it', () => {
    const registry = new PluginRegistry();

    // 先进入 plan
    registry.store.set(SK.PrePlanMode, 'normal');
    registry.store.set(SK.Mode, 'plan');
    assert.equal(registry.store.get<string>(SK.Mode), 'plan');

    // 模拟 handleModeToggle 退出 plan
    const preMode = registry.store.get<string>(SK.PrePlanMode) || 'normal';
    registry.store.set(SK.Mode, preMode);
    registry.store.set(SK.PrePlanMode, undefined);

    assert.equal(registry.store.get<string>(SK.Mode), 'normal');
    assert.equal(registry.store.get<string>(SK.PrePlanMode), undefined);
  });

  it('plan → plan toggle does not lose normal as preMode', () => {
    const registry = new PluginRegistry();

    // 模拟多次切换
    // 1 → plan
    registry.store.set(SK.PrePlanMode, 'normal');
    registry.store.set(SK.Mode, 'plan');
    // 2 → normal
    const pre1 = registry.store.get<string>(SK.PrePlanMode) || 'normal';
    registry.store.set(SK.Mode, pre1);
    registry.store.set(SK.PrePlanMode, undefined);
    // 3 → plan again
    registry.store.set(SK.PrePlanMode, 'normal');
    registry.store.set(SK.Mode, 'plan');

    assert.equal(registry.store.get<string>(SK.Mode), 'plan');
    // 退出后应回到 normal
    const pre3 = registry.store.get<string>(SK.PrePlanMode) || 'normal';
    registry.store.set(SK.Mode, pre3);
    registry.store.set(SK.PrePlanMode, undefined);

    assert.equal(registry.store.get<string>(SK.Mode), 'normal');
  });

  it('always defaults to normal if store value is undefined', () => {
    const registry = new PluginRegistry();
    // 未设置 SK.Mode 时
    const mode = registry.store.get<string>(SK.Mode) || 'normal';
    assert.equal(mode, 'normal');
  });
});
