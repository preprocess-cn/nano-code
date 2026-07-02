// Public API entry point for the Ink engine (replaces CC's src/ink.ts)
// Re-exports what design-system and external consumers need.

import { ThemeProvider, usePreviewTheme, useTheme, useThemeSetting } from '#src/plugins/display/claude-code-ink/design-system/ThemeProvider.js';
import { color } from '#src/plugins/display/claude-code-ink/design-system/color.js';
import type { Props as BoxProps } from '#src/plugins/display/claude-code-ink/design-system/ThemedBox.js';
export { default as Box } from '#src/plugins/display/claude-code-ink/design-system/ThemedBox.js';
export type { Props as TextProps } from '#src/plugins/display/claude-code-ink/design-system/ThemedText.js';
export { default as Text } from '#src/plugins/display/claude-code-ink/design-system/ThemedText.js';
export { ThemeProvider, usePreviewTheme, useTheme, useThemeSetting, color };

export { Ansi } from '#src/plugins/display/claude-code-ink/engine/Ansi.js';
export { RawAnsi } from '#src/plugins/display/claude-code-ink/engine/components/RawAnsi.js';
export type { DOMElement } from '#src/plugins/display/claude-code-ink/engine/dom.js';
export { default as BaseBox } from '#src/plugins/display/claude-code-ink/engine/components/Box.js';
export type { Props as NewlineProps } from '#src/plugins/display/claude-code-ink/engine/components/Newline.js';
export { default as Newline } from '#src/plugins/display/claude-code-ink/engine/components/Newline.js';
export { default as Spacer } from '#src/plugins/display/claude-code-ink/engine/components/Spacer.js';
export { default as BaseText } from '#src/plugins/display/claude-code-ink/engine/components/Text.js';
export { default as measureElement } from '#src/plugins/display/claude-code-ink/engine/measure-element.js';
export { default as useApp } from '#src/plugins/display/claude-code-ink/engine/hooks/use-app.js';
export { default as useInput } from '#src/plugins/display/claude-code-ink/engine/hooks/use-input.js';
export { default as useStdin } from '#src/plugins/display/claude-code-ink/engine/hooks/use-stdin.js';
export { useTerminalFocus } from '#src/plugins/display/claude-code-ink/engine/hooks/use-terminal-focus.js';
export { useTerminalTitle } from '#src/plugins/display/claude-code-ink/engine/hooks/use-terminal-title.js';
export { useTerminalViewport } from '#src/plugins/display/claude-code-ink/engine/hooks/use-terminal-viewport.js';
export { useTabStatus } from '#src/plugins/display/claude-code-ink/engine/hooks/use-tab-status.js';
export { stringWidth } from '#src/plugins/display/claude-code-ink/engine/stringWidth.js';
export { default as wrapText } from '#src/plugins/display/claude-code-ink/engine/wrap-text.js';
export { supportsTabStatus } from '#src/plugins/display/claude-code-ink/engine/termio/osc.js';

// Re-export Ink render function for the display plugin
export { default as inkRender, createRoot } from '#src/plugins/display/claude-code-ink/engine/root.js';
export type { Instance, Root } from '#src/plugins/display/claude-code-ink/engine/root.js';
