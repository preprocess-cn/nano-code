import React from 'react';
import { Box, Text, stringWidth, useAnimationFrame } from '#src/plugins/display/claude-code-ink/ink.js';

interface StatusBarProps {
  /** 状态栏左侧段落（KEY: VALUE） */
  segments?: Record<string, string>;
  /** 状态栏右侧通知消息 */
  notification?: { source: string; message: string } | null;

  /** LLM 执行状态 */
  llmStatus?: 'idle' | 'running';
  /** LLM 本轮开始时间戳 */
  llmStartTime?: number;
  /** LLM 本轮累积 token */
  turnTokens?: number;
}

/** Starburst 动画帧序列（CC 兼容） */
const SPINNER_FRAMES = ['·', '✢', '✲', '✶', '✻', '✽', '✻', '✶', '✲', '✢'];

/** 格式化耗时：Xs / Xm Ys / Xh Ym Zs */
function formatElapsed(startTime: number): string {
  const ms = Date.now() - startTime;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 格式化 token 数 */
function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  return `${(n / 1000).toFixed(1)}K tokens`;
}

/**
 * 动画 LLM 指示器 — 使用 useAnimationFrame 驱动旋转图标。
 * 拆分到独立组件以隔离 hooks 调用。
 */
function LlmSpinner({ startTime, tokens }: { startTime: number; tokens: number }): React.ReactElement {
  const [spinnerRef, animTime] = useAnimationFrame(50);
  const frameIdx = Math.floor(animTime / 120) % SPINNER_FRAMES.length;
  const elapsedStr = formatElapsed(startTime);
  const tokenStr = formatTokens(tokens);
  const spinnerChar = SPINNER_FRAMES[frameIdx];

  // 固定宽度 — timer 3 列 (0s-59s), tokens 12 列 (足以容纳 " 999 tokens")
  const paddedTimer = elapsedStr.padEnd(3, ' ');
  const paddedToken = ` ${tokenStr}`.padEnd(13, ' ');

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Box, { key: 'spinner', ref: spinnerRef, width: 2, flexShrink: 0 },
      React.createElement(Text, { color: '#ff6b35' }, spinnerChar + ' '),
    ),
    React.createElement(Text, { key: 'elapsed', dimColor: true }, paddedTimer),
    React.createElement(Text, { key: 'tokens', dimColor: true }, paddedToken),
  );
}

/**
 * 状态栏组件 — 渲染在屏幕最底部。
 * 左侧: mode 特殊指示 + KEY: VALUE 段落的持久状态
 * 右侧: LLM 执行状态（running 时显示动画+耗时+token）或通知消息
 */
export function StatusBar({ segments, notification, llmStatus, llmStartTime, turnTokens }: StatusBarProps): React.ReactElement | null {
  const hasNotification = notification && notification.source && notification.message;
  const isLlmRunning = llmStatus === 'running' && llmStartTime && llmStartTime > 0;

  // Extract "mode" segment for special rendering
  const modeValue = segments?.mode;
  const otherSegments: Record<string, string> = {};
  if (segments) {
    for (const [key, value] of Object.entries(segments)) {
      if (key !== 'mode' && value) otherSegments[key] = value;
    }
  }
  const hasOtherSegments = Object.keys(otherSegments).length > 0;

  // Build left side parts
  const leftChildren: React.ReactNode[] = [];

  // Mode indicator — special rendering
  if (modeValue === 'plan') {
    leftChildren.push(
      React.createElement(Text, { key: 'mode', color: '#f59e0b', bold: true }, '● PLAN'),
    );
    leftChildren.push(
      React.createElement(Text, { key: 'hint', dimColor: true }, ' (Shift+Tab)'),
    );
  } else if (modeValue === 'normal') {
    leftChildren.push(
      React.createElement(Text, { key: 'mode', dimColor: true }, '○ NORMAL'),
    );
    leftChildren.push(
      React.createElement(Text, { key: 'hint', dimColor: true }, ' (Shift+Tab)'),
    );
  } else if (modeValue) {
    leftChildren.push(
      React.createElement(Text, { key: 'mode', dimColor: true }, modeValue),
    );
  }

  // Other segments as "KEY: VALUE"
  if (hasOtherSegments) {
    if (leftChildren.length > 0) {
      leftChildren.push(
        React.createElement(Text, { key: 'mode-sep', dimColor: true }, ' | '),
      );
    }
    const textParts: string[] = [];
    for (const [key, value] of Object.entries(otherSegments)) {
      textParts.push(`${key}: ${value}`);
    }
    leftChildren.push(
      React.createElement(Text, { key: 'segments', dimColor: true }, textParts.join(' | ')),
    );
  }

  // Build right side parts
  const rightChildren: React.ReactNode[] = [];

  if (isLlmRunning) {
    // LLM 执行中 — 动画图标 + 耗时 + token（使用隔离的子组件以安全调用 hooks）
    rightChildren.push(
      React.createElement(LlmSpinner, { key: 'llm', startTime: llmStartTime, tokens: turnTokens ?? 0 }),
    );
  } else if (hasNotification) {
    // 通知文本
    let notifText = `[${notification!.source}] ${notification!.message}`;
    const maxWidth = Math.max(40, Math.floor((process.stdout.columns || 80) * 0.4));
    if (stringWidth(notifText) > maxWidth) {
      while (stringWidth(notifText) > maxWidth - 2) {
        notifText = notifText.slice(0, -1);
      }
      notifText = notifText.slice(0, -1) + '…';
    }
    rightChildren.push(
      React.createElement(Text, { key: 'notif', dimColor: true }, notifText),
    );
  }

  const hasRightContent = rightChildren.length > 0;

  // 始终保留空 Text 节点（即使无内容），避免终端旧文本残留
  if (!hasRightContent) {
    rightChildren.push(
      React.createElement(Text, { key: 'empty' }, ''),
    );
  }

  return React.createElement(
    Box,
    {
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: 'row',
      position: 'relative',
    },
    // 左侧 — 模式 + 固定状态段落
    leftChildren.length > 0
      ? React.createElement(Box, { key: 'left', flexGrow: 0, flexShrink: 0 }, ...leftChildren)
      : null,
    // 右侧 — 绝对定位到右端。计时和 token 文本已固定宽度，
    // 整个右区内容宽度恒定 18 列，Box 不发生尺寸变化，位置彻底稳定。
    hasRightContent
      ? React.createElement(Box, { key: 'right', position: 'absolute', right: 1, flexGrow: 0, flexShrink: 0, alignItems: 'center' }, ...rightChildren)
      : null,
  );
}
