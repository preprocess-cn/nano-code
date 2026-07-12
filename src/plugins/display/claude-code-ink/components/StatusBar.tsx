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
 *
 * 布局结构（左/中弹性 spacer/右）保证左右区域在布局上完全独立，
 * 右侧内容变化不影响左侧渲染：
 *   <Box row>
 *     <Box flexGrow=0 flexShrink=0>  leftContent  </Box>
 *     <Box flexGrow=1 />                            ← 弹性 spacer
 *     <Box flexGrow=0 flexShrink=0 marginLeft=1>  rightContent  </Box>
 *   </Box>
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
    // Non-plan string values shown as plain dim text
    leftChildren.push(
      React.createElement(Text, { key: 'mode', dimColor: true }, modeValue),
    );
  }

  // Other segments as "KEY: VALUE"
  if (hasOtherSegments) {
    // 如果 mode 已显示，用 | 隔开
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

  // Notification text
  if (hasNotification) {
    let notifText = `[${notification!.source}] ${notification!.message}`;
    const maxWidth = Math.max(40, Math.floor((process.stdout.columns || 80) * 0.4));
    if (stringWidth(notifText) > maxWidth) {
      while (stringWidth(notifText) > maxWidth - 2) {
        notifText = notifText.slice(0, -1);
      }
      notifText = notifText.slice(0, -1) + '…';
    }
    if (rightChildren.length > 0) {
      rightChildren.push(React.createElement(Text, { key: 'notif-sep' }, '  '));
    }
    rightChildren.push(
      React.createElement(Text, { key: 'notif', dimColor: true }, notifText),
    );
  }

  const hasRightContent = rightChildren.length > 0;

  // 始终保留空 Text 节点（即使无通知），
  // 让 Ink reconciler 做原地文本更新（"通知文本" → ""），
  // 避免 DOM 节点移除导致终端旧文本残留。
  if (!hasNotification) {
    rightChildren.push(
      React.createElement(Text, { key: 'notif' }, ''),
    );
  }

  return React.createElement(
    Box,
    {
      height: 1,
      flexShrink: 0,
      paddingLeft: 1,
      paddingRight: 1,
    },
    // 左侧 — 模式 + 固定状态段落
    leftChildren.length > 0
      ? React.createElement(Box, { key: 'left', flexGrow: 0, flexShrink: 0 }, ...leftChildren)
      : null,
    // 弹性 spacer — 将右侧推到最右
    hasRightContent
      ? React.createElement(Box, { key: 'spacer', flexGrow: 1 })
      : null,
    // 右侧 — 模式提示 + 通知
    hasRightContent
      ? React.createElement(Box, { key: 'right', flexGrow: 0, flexShrink: 0, marginLeft: 1 }, ...rightChildren)
      : null,
  );
}
