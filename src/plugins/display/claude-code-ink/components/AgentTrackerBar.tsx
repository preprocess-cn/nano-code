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

/**
 * AgentTrackerBar — 底部 Agent 任务面板。
 * 有 running 子 agent 时显示，全部完成后自动隐藏。
 */
export function AgentTrackerBar({
  states,
  agentColorMap,
  selectedIndex,
  currentView,
  focusMode,
}: AgentTrackerBarProps): React.ReactElement | null {
  const subAgents = states.filter(s => s.type && s.fullName && s.fullName !== 'main');
  const running = subAgents.filter(s => s.status === 'running');
  if (running.length === 0) return null;

  const isInFocus = focusMode === 'agent-list';
  const isMainSelected = isInFocus && selectedIndex === 0;

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingLeft: 1, paddingBottom: 1 },
    // Main 行（selectedIndex=0）
    React.createElement(
      Box,
      { height: 1 },
      React.createElement(Text, null,
        isMainSelected
          ? React.createElement(Text, { color: '#64748b', bold: true }, '❯ ')
          : React.createElement(Text, null, '  '),
        React.createElement(Text, { dimColor: !isMainSelected }, '○ main'),
      ),
    ),
    // 子 agent 行（selectedIndex=1+）
    ...running.map((s, i) => {
      const isSelected = isInFocus && selectedIndex > 0 && i === selectedIndex - 1;
      const isViewing = currentView === s.fullName;
      const agentColor = agentColorMap?.[s.fullName] || '#06b6d4';
      const bullet = isViewing ? '●' : '○';

      return React.createElement(
        Box,
        { key: s.fullName, height: 1, flexDirection: 'row' },
        React.createElement(Text, null,
          isSelected
            ? React.createElement(Text, { color: agentColor, bold: true }, '❯ ')
            : React.createElement(Text, null, '  '),
          React.createElement(Text, { color: isViewing ? agentColor : undefined, dimColor: !isViewing }, `${bullet} `),
          React.createElement(Text, { color: agentColor, bold: isSelected || isViewing }, s.type),
          s.query
            ? React.createElement(Text, { dimColor: true }, ` · ${s.query}`)
            : null,
        ),
      );
    }),
    isInFocus
      ? React.createElement(Text, { dimColor: true }, '↑↓ 选择 · Enter 查看 · Tab/Esc 返回')
      : React.createElement(Text, { dimColor: true }, 'Tab 切换 Agent 列表'),
  );
}
