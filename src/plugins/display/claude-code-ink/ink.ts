// Public API entry point for the Ink engine (replaces CC's src/ink.ts)
// Re-exports what design-system and external consumers need.

import { ThemeProvider, usePreviewTheme, useTheme, useThemeSetting } from './design-system/ThemeProvider.js';
import { color } from './design-system/color.js';
import type { Props as BoxProps } from './design-system/ThemedBox.js';
export { default as Box } from './design-system/ThemedBox.js';
export type { Props as TextProps } from './design-system/ThemedText.js';
export { default as Text } from './design-system/ThemedText.js';
export { ThemeProvider, usePreviewTheme, useTheme, useThemeSetting, color };

export { Ansi } from './engine/Ansi.js';
export type { DOMElement } from './engine/dom.js';
export { default as BaseBox } from './engine/components/Box.js';
export type { Props as NewlineProps } from './engine/components/Newline.js';
export { default as Newline } from './engine/components/Newline.js';
export { default as Spacer } from './engine/components/Spacer.js';
export { default as BaseText } from './engine/components/Text.js';
export { default as measureElement } from './engine/measure-element.js';
export { default as useApp } from './engine/hooks/use-app.js';
export { default as useInput } from './engine/hooks/use-input.js';
export { default as useStdin } from './engine/hooks/use-stdin.js';
export { useTerminalFocus } from './engine/hooks/use-terminal-focus.js';
export { useTerminalTitle } from './engine/hooks/use-terminal-title.js';
export { useTerminalViewport } from './engine/hooks/use-terminal-viewport.js';
export { useTabStatus } from './engine/hooks/use-tab-status.js';
export { stringWidth } from './engine/stringWidth.js';
export { default as wrapText } from './engine/wrap-text.js';
export { supportsTabStatus } from './engine/termio/osc.js';

// Re-export Ink render function for the display plugin
export { default as inkRender, createRoot } from './engine/root.js';
export type { Instance, Root } from './engine/root.js';
