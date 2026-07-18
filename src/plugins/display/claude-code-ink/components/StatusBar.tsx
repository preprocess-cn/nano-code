import React from 'react';
import { Box, Text, stringWidth } from '#src/plugins/display/claude-code-ink/ink.js';

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

/**
 * 状态栏组件 — 渲染在屏幕最底部。
 * 左侧: mode 特殊指示 + KEY: VALUE 段落的持久状态
 * 右侧: 通知消息（LLM 状态在消息流 SpinnerWithVerb 中展示）
 */
export function StatusBar({ segments, notification }: StatusBarProps): React.ReactElement | null {
  const hasNotification = notification && notification.source && notification.message;

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

  // Build right side parts — 仅通知消息（LLM 状态由 SpinnerWithVerb 展示）
  const rightChildren: React.ReactNode[] = [];

  if (hasNotification) {
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
    // 右侧 — 绝对定位到右端，显示通知消息。
    hasRightContent
      ? React.createElement(Box, { key: 'right', position: 'absolute', right: 1, flexGrow: 0, flexShrink: 0, alignItems: 'center' }, ...rightChildren)
      : null,
  );
}
