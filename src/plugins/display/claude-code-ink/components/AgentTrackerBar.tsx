import React from 'react';
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js';
import type { AgentRuntimeState } from '#src/plugins/display/claude-code-ink/InkApp.js';

interface AgentTrackerBarProps {
  states: AgentRuntimeState[];
  agentColorMap?: Record<string, string>;
  selectedIndex: number;
  currentView?: string;
  focusMode: 'input' | 'agent-list';
}

function formatDuration(elapsedMs: number): string {
  const totalSec = Math.round(elapsedMs / 1000);
  if (totalSec > 60) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${totalSec}s`;
}

/**
 * AgentTrackerBar — 可聚焦的子 Agent 列表。
 * 键盘交互由 AppContent 统一管理，通过 focusMode + selectedIndex 驱动。
 */
export function AgentTrackerBar({ states, agentColorMap, selectedIndex, currentView, focusMode }: AgentTrackerBarProps): React.ReactElement | null {
  const displayStates = states.filter(s => s.type && s.fullName && s.fullName !== 'main' && s.status === 'running');
  if (displayStates.length === 0) return null;

  const safeIndex = Math.min(selectedIndex, displayStates.length - 1);
  const isInFocus = focusMode === 'agent-list';

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingLeft: 1, paddingBottom: 1 },
    React.createElement(Text, { dimColor: true }, '── Agent ─────────────────────────────'),
    ...displayStates.map((s, i) => {
      const isSelected = i === safeIndex;
      const isViewing = currentView === s.fullName;
      const isLast = i === displayStates.length - 1;
      const agentColor = agentColorMap?.[s.fullName] || '#06b6d4';

      const treeChar = isLast ? '└─ ' : '├─ ';

      const elapsedMs = s.status === 'running'
        ? Date.now() - s.startTime
        : (s.endTime ? s.endTime - s.startTime : 0);
      const timeStr = formatDuration(elapsedMs);

      // Build line: treeChar [type]  status · N工具 · Xs
      let statusDisplay: string;
      if (s.status === 'running') {
        statusDisplay = `运行中 · ${s.toolUseCount}工具 · ${timeStr}`;
      } else if (s.status === 'completed') {
        statusDisplay = `完成 · ${s.toolUseCount}工具 · ${timeStr}`;
      } else {
        statusDisplay = '错误';
      }

      return React.createElement(
        Box,
        { key: s.fullName, height: 1 },
        React.createElement(
          Text,
          null,
          // Selection pointer (only in focus mode)
          isInFocus && isSelected
            ? React.createElement(Text, { color: agentColor }, '▸ ')
            : React.createElement(Text, null, '  '),
          // Tree char
          React.createElement(Text, { dimColor: true, color: isViewing ? agentColor : undefined }, treeChar),
          // Agent type
          React.createElement(Text, { color: agentColor, bold: isSelected || isViewing }, s.type),
          // Status
          React.createElement(Text, { dimColor: !isSelected && !isViewing, bold: isViewing }, `  ${statusDisplay}`),
        ),
      );
    }),
    isInFocus
      ? React.createElement(Text, { dimColor: true }, '↑↓ 选择 · Enter 查看 · Esc 返回输入')
      : React.createElement(Text, { dimColor: true }, '↓ 切换到 Agent 列表'),
  );
}
