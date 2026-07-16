import React from 'react';
import { Box, Text, useAnimationFrame } from '#src/plugins/display/claude-code-ink/ink.js';

/** Braille 盲文点动画帧（CC 兼容） */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * 基础动画 Spinner 组件 — Braille 盲文点旋转动画。
 * 使用 useAnimationFrame(120ms) 驱动，约 8fps。
 * 无 props，与 LoadingState.tsx 完全兼容。
 */
export function Spinner(): React.ReactElement {
  const [ref, time] = useAnimationFrame(120);
  const frameIdx = Math.floor(time / 120) % BRAILLE_FRAMES.length;
  return React.createElement(
    Box,
    { ref, width: 2, flexShrink: 0 },
    React.createElement(Text, { color: '#ff6b35' }, BRAILLE_FRAMES[frameIdx]),
  );
}
