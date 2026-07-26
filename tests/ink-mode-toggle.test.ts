import { describe, it } from 'vitest';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/core/plugin.js';
import { toggleMode } from '../src/plugins/display/claude-code-ink/index.js';
import { SK } from '../src/store-keys.js';

describe('Mode toggle (Shift+Tab)', () => {
  it('default mode is normal', () => {
    const registry = new PluginRegistry();
    const mode = registry.store.get<string>(SK.Mode) || 'normal';
    assert.equal(mode, 'normal');
  });

  it('normal → plan: saves PrePlanMode and sets Mode to plan', () => {
    const registry = new PluginRegistry();
    toggleMode(registry.store);

    assert.equal(registry.store.get<string>(SK.Mode), 'plan');
    assert.equal(registry.store.get<string>(SK.PrePlanMode), 'normal');
  });

  it('plan → normal: restores PrePlanMode and clears it', () => {
    const registry = new PluginRegistry();

    // enter plan
    toggleMode(registry.store);
    assert.equal(registry.store.get<string>(SK.Mode), 'plan');

    // exit plan
    toggleMode(registry.store);

    assert.equal(registry.store.get<string>(SK.Mode), 'normal');
    assert.equal(registry.store.get<string>(SK.PrePlanMode), undefined);
  });

  it('plan → plan toggle does not lose normal as preMode', () => {
    const registry = new PluginRegistry();

    // 1 → plan
    toggleMode(registry.store);
    // 2 → normal
    toggleMode(registry.store);
    // 3 → plan again
    toggleMode(registry.store);

    assert.equal(registry.store.get<string>(SK.Mode), 'plan');
    assert.equal(registry.store.get<string>(SK.PrePlanMode), 'normal');

    // exit → normal
    toggleMode(registry.store);
    assert.equal(registry.store.get<string>(SK.Mode), 'normal');
  });

  it('always defaults to normal if store value is undefined', () => {
    const registry = new PluginRegistry();
    const mode = registry.store.get<string>(SK.Mode) || 'normal';
    assert.equal(mode, 'normal');
  });
});
