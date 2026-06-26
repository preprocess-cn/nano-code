import { useInput } from '../ink.js';
import type { Key } from '../engine/events/input-event.js';

export function createMatcher(keySpec: string): (input: string, key: Key) => boolean {
  const parts = keySpec.toLowerCase().split('+');
  const mods: Record<string, boolean> = { ctrl: false, meta: false, shift: false };
  let mainKey = '';

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') mods.ctrl = true;
    else if (part === 'meta' || part === 'cmd' || part === 'command') mods.meta = true;
    else if (part === 'shift') mods.shift = true;
    else if (part === 'alt' || part === 'opt' || part === 'option') mods.meta = true;
    else mainKey = part;
  }

  return (input: string, key: Key): boolean => {
    if (key.ctrl !== mods.ctrl) return false;
    if (key.meta !== mods.meta) return false;
    if (key.shift !== mods.shift) return false;

    const namedKeyMap: Record<string, keyof Key> = {
      escape: 'escape',
      enter: 'return',
      return: 'return',
      backspace: 'backspace',
      delete: 'delete',
      tab: 'tab',
      up: 'upArrow',
      down: 'downArrow',
      left: 'leftArrow',
      right: 'rightArrow',
      pageup: 'pageUp',
      pagedown: 'pageDown',
      home: 'home',
      end: 'end',
    };

    if (mainKey in namedKeyMap) {
      return key[namedKeyMap[mainKey]] === true;
    }

    if (mainKey.length === 1) {
      return input.toLowerCase() === mainKey;
    }

    return false;
  };
}

export function useKeybinding(keySpec: string, handler: () => void, isActive = true): void {
  const matcher = createMatcher(keySpec);
  useInput((input: string, key: Key) => { if (matcher(input, key)) handler(); }, { isActive });
}

export function useKeybindings(bindings: Record<string, () => void>, isActive = true): void {
  const matchers = Object.entries(bindings).map(([k, h]) => ({ match: createMatcher(k), handler: h }));
  useInput((input: string, key: Key) => {
    for (const { match, handler } of matchers) {
      if (match(input, key)) { handler(); return; }
    }
  }, { isActive });
}
