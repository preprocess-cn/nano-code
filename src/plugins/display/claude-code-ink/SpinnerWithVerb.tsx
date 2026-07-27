import React, { useRef } from 'react';
import { Box, Text, useAnimationFrame } from '#src/plugins/display/claude-code-ink/ink.js';
import { formatDuration, formatTokens } from '#src/utils/format.js';
import { debugLog } from '#src/plugins/display/claude-code-ink/utils/debugLog.js';

/** Starburst 动画帧序列（与 StatusBar LlmSpinner 一致） */
const SPINNER_FRAMES = ['·', '✢', '✲', '✶', '✻', '✽', '✻', '✶', '✲', '✢'];

const COLOR_ACTIVE = '#ff6b35';
const COLOR_STALLED = '#ef4444';
const STALL_THRESHOLD_MS = 3000;

export interface SpinnerWithVerbProps {
  /** LLM 轮次开始时间戳（用于计算耗时） */
  startTime: number;
  /** 本轮 token 计数 */
  tokens: number;
  /** 最近一次 LLM 活动时间戳（流分片/工具调用） */
  lastTokenTime: number;
  /** 自定义动词，默认 "Thinking" */
  verb?: string;
  /** 是否强制显示 stalled 态（用于测试） */
  stalled?: boolean;
}

/**
 * SpinnerWithVerb — 消息流中的处理态指示器。
 *
 * 渲染为单行，显示在 ScrollBox 内消息列表之后：
 *   [动画帧] Thinking · 30s · 1.2K tokens
 *
 * stalled 时（3s 无新 token）变红：
 *   [红色动画帧] Thinking · 45s · 1.2K tokens · stalled
 *
 * 等效于 CC 的 SpinnerWithVerb 组件。
 */
export function SpinnerWithVerb({
  startTime,
  tokens,
  lastTokenTime,
  verb = 'Thinking',
  stalled: forceStalled,
}: SpinnerWithVerbProps): React.ReactElement {
  const [ref, animTime] = useAnimationFrame(50);
  const frameIdx = Math.floor(animTime / 120) % SPINNER_FRAMES.length;
  const _lastLogRef = useRef(0);

  const stalled = forceStalled !== undefined ? forceStalled : (Date.now() - lastTokenTime) > STALL_THRESHOLD_MS;
  const color = stalled ? COLOR_STALLED : COLOR_ACTIVE;

  const elapsedStr = formatDuration(Date.now() - startTime);
  const tokenStr = formatTokens(tokens);

  // Throttled spinner state log: once per second
  const now = Date.now();
  if (now - _lastLogRef.current > 1000) {
    _lastLogRef.current = now;
    debugLog(`spinner: tokens=${tokens} elapsed=${elapsedStr} verb=${verb} stalled=${stalled} startTime=${startTime}`);
  }

  return React.createElement(
    Box,
    { flexDirection: 'row', alignItems: 'center', paddingLeft: 1, paddingY: 1 },
    React.createElement(Box, { ref, width: 2, flexShrink: 0 },
      React.createElement(Text, { color }, SPINNER_FRAMES[frameIdx]),
    ),
    React.createElement(Text, { dimColor: stalled }, ` ${verb} · ${elapsedStr} · ${tokenStr}`),
    stalled
      ? React.createElement(Text, { dimColor: true, color: COLOR_STALLED }, ' · stalled')
      : null,
  );
}
