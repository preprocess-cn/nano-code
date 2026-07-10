import React from 'react';
import { Box, Text, stringWidth } from '#src/plugins/display/claude-code-ink/ink.js';

interface StatusBarProps {
  /** 状态栏左侧段落（KEY: VALUE） */
  segments?: Record<string, string>;
  /** 状态栏右侧通知消息 */
  notification?: { source: string; message: string } | null;
}

/**
 * 状态栏组件 — 渲染在屏幕最底部。
 * 左侧: mode 特殊指示 + KEY: VALUE 段落的持久状态
 * 右侧: 来源通知消息（单行，超长截断）
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

  if (!modeValue && !hasOtherSegments && !hasNotification) return null;

  // Build left side parts
  const leftParts: React.ReactElement[] = [];

  // Mode indicator — special rendering
  if (modeValue === 'plan') {
    leftParts.push(
      React.createElement(Text, { key: 'mode', color: '#f59e0b', bold: true }, '● PLAN'),
    );
  } else if (modeValue) {
    // Non-plan string values shown as plain dim text
    leftParts.push(
      React.createElement(Text, { key: 'mode', dimColor: true }, modeValue),
    );
  }

  // Other segments as "KEY: VALUE"
  if (hasOtherSegments) {
    const textParts: string[] = [];
    for (const [key, value] of Object.entries(otherSegments)) {
      textParts.push(`${key}: ${value}`);
    }
    leftParts.push(
      React.createElement(Text, { key: 'segments', dimColor: true }, textParts.join(' · ')),
    );
  }

  // Build right side items
  const rightItems: React.ReactElement[] = [];

  // Plan mode hint
  if (modeValue === 'plan') {
    rightItems.push(
      React.createElement(Text, { key: 'hint', dimColor: true }, '(Shift+Tab)'),
    );
  }

  // Notification text
  if (hasNotification) {
    let notifText = `[${notification!.source}] ${notification!.message}`;
    const maxWidth = Math.max(40, Math.floor((process.stdout.columns || 80) * 0.4));
    if (stringWidth(notifText) > maxWidth) {
      while (stringWidth(notifText) > maxWidth - 1) {
        notifText = notifText.slice(0, -1);
      }
      notifText = notifText.slice(0, -1) + '…';
    }
    if (rightItems.length > 0) {
      rightItems.push(React.createElement(Text, { key: 'notif-sep' }, '  '));
    }
    rightItems.push(
      React.createElement(Text, { key: 'notif', dimColor: true }, notifText),
    );
  }

  const separator = leftParts.length > 0 && rightItems.length > 0 ? '   ' : '';

  return React.createElement(
    Box,
    {
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
    },
    ...leftParts,
    separator
      ? React.createElement(Text, { key: 'sep' }, separator)
      : null,
    rightItems.length > 0
      ? React.createElement(
          Box,
          { key: 'right', flexGrow: 1, justifyContent: 'flexEnd' },
          ...rightItems,
        )
      : null,
  );
}
