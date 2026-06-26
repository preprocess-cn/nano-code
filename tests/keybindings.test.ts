import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createMatcher } from '../src/plugins/display/claude-code-ink/stubs/keybindings.js';

type Key = {
  ctrl: boolean; shift: boolean; meta: boolean;
  escape: boolean; return: boolean; backspace: boolean; delete: boolean; tab: boolean;
  upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean;
  pageUp: boolean; pageDown: boolean; home: boolean; end: boolean;
  wheelUp: boolean; wheelDown: boolean;
  fn: boolean; super: boolean;
};

function key(overrides: Partial<Key> = {}): Key {
  return {
    ctrl: false, shift: false, meta: false,
    escape: false, return: false, backspace: false, delete: false, tab: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    wheelUp: false, wheelDown: false,
    fn: false, super: false,
    ...overrides,
  };
}

describe('createMatcher — ctrl+c', () => {

  const match = createMatcher('ctrl+c');

  it('matches ctrl+c', () => {
    assert.equal(match('c', key({ ctrl: true })), true);
  });

  it('does not match bare c', () => {
    assert.equal(match('c', key()), false);
  });

  it('does not match ctrl+shift+c', () => {
    assert.equal(match('c', key({ ctrl: true, shift: true })), false);
  });

  it('does not match ctrl+x', () => {
    assert.equal(match('x', key({ ctrl: true })), false);
  });

});

describe('createMatcher — escape', () => {

  const match = createMatcher('escape');

  it('matches escape', () => {
    assert.equal(match('', key({ escape: true })), true);
  });

  it('does not match other keys', () => {
    assert.equal(match('', key({ return: true })), false);
    assert.equal(match('', key({ backspace: true })), false);
  });

});

describe('createMatcher — ctrl+shift+f', () => {

  const match = createMatcher('ctrl+shift+f');

  it('matches ctrl+shift+f', () => {
    assert.equal(match('f', key({ ctrl: true, shift: true })), true);
  });

  it('does not match ctrl+f', () => {
    assert.equal(match('f', key({ ctrl: true })), false);
  });

  it('does not match shift+f', () => {
    assert.equal(match('F', key({ shift: true })), false);
  });

});

describe('createMatcher — enter', () => {

  const match = createMatcher('enter');

  it('matches return', () => {
    assert.equal(match('', key({ return: true })), true);
  });

  it('does not match tab', () => {
    assert.equal(match('', key({ tab: true })), false);
  });

});

describe('createMatcher — modifier aliases', () => {

  it('control is alias for ctrl', () => {
    assert.equal(createMatcher('control+c')('c', key({ ctrl: true })), true);
  });

  it('cmd is alias for meta', () => {
    assert.equal(createMatcher('cmd+c')('c', key({ meta: true })), true);
  });

  it('alt maps to meta (Ink compat)', () => {
    assert.equal(createMatcher('alt+c')('c', key({ meta: true })), true);
  });

});

describe('createMatcher — case insensitive', () => {

  it('Ctrl+C matches same as ctrl+c', () => {
    assert.equal(createMatcher('Ctrl+C')('c', key({ ctrl: true })), true);
  });

});

describe('createMatcher — arrow keys', () => {

  it('up matches upArrow', () => {
    assert.equal(createMatcher('up')('', key({ upArrow: true })), true);
  });

  it('down matches downArrow', () => {
    assert.equal(createMatcher('down')('', key({ downArrow: true })), true);
  });

  it('left matches leftArrow', () => {
    assert.equal(createMatcher('left')('', key({ leftArrow: true })), true);
  });

  it('right matches rightArrow', () => {
    assert.equal(createMatcher('right')('', key({ rightArrow: true })), true);
  });

});
