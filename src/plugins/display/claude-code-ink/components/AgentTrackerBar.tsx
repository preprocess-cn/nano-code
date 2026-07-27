import React from 'react';
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js';
import type { AgentRuntimeState } from '#src/plugins/display/claude-code-ink/InkApp.js';

interface AgentTrackerBarProps {
  states: AgentRuntimeState[];
  agentColorMap?: Record<string, string>;
  currentView?: string;
  selectedIndex?: number;
  isFocused?: boolean;
}

function formatDuration(state: AgentRuntimeState): string {
  const end = state.status === 'running' ? Date.now() : (state.endTime ?? Date.now());
  const ms = Math.max(0, end - state.startTime);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  return `${(n / 1000).toFixed(1)}K tokens`;
}

/**
 * AgentTrackerBar — 底部 Agent 任务面板。
 * 有 running 子 agent 时显示，全部完成后自动隐藏。
 * 支持键盘导航：↑↓ 选择 item，Enter 查看 agent，Esc 返回。
 */
export function AgentTrackerBar({
  states,
  agentColorMap,
  currentView,
  selectedIndex,
  isFocused,
}: AgentTrackerBarProps): React.ReactElement | null {
  const subAgents = states.filter(s => s.type && s.fullName && s.fullName !== 'main');
  const running = subAgents.filter(s => s.status === 'running');
  if (running.length === 0) return null;

  const isViewingMain = !currentView;
  const BASE_COLOR = '#06b6d4';

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingLeft: 1, paddingBottom: 1 },
    // Main 行
    (() => {
      const idx = 0;
      const isSelected = isFocused && selectedIndex === idx;
      return React.createElement(
        Box,
        { height: 1 },
        React.createElement(Text, null,
          React.createElement(Text, {
            inverse: isSelected,
            color: isViewingMain ? BASE_COLOR : undefined,
            dimColor: !isViewingMain && !isSelected,
            bold: isViewingMain,
          },
            `${isViewingMain ? '●' : '○'} `),
          React.createElement(Text, {
            inverse: isSelected,
            color: BASE_COLOR,
            bold: isViewingMain || isSelected,
          }, 'main'),
        ),
      );
    })(),
    // 子 agent 行
    ...running.map((s, i) => {
      const listIdx = i + 1;
      const isViewing = currentView === s.fullName;
      const isSelected = isFocused && selectedIndex === listIdx;
      const agentColor = agentColorMap?.[s.fullName] || BASE_COLOR;
      const bullet = isViewing ? '●' : '○';
      const durationStr = formatDuration(s);
      const tokensStr = formatTokens(s.tokens);

      return React.createElement(
        Box,
        { key: s.fullName, height: 1, flexDirection: 'row' },
        React.createElement(Text, null,
          React.createElement(Text, {
            inverse: isSelected,
            color: isViewing || isSelected ? agentColor : undefined,
            dimColor: !isViewing && !isSelected,
            bold: isViewing || isSelected,
          }, `${bullet} `),
          React.createElement(Text, {
            inverse: isSelected,
            color: agentColor,
            bold: isViewing || isSelected,
          }, s.type),
          s.query
            ? React.createElement(Text, { dimColor: true }, ` · ${s.query}`)
            : null,
          s.description
            ? React.createElement(Text, { dimColor: true }, ` · ${s.description}`)
            : null,
          React.createElement(Text, { dimColor: true }, `  ${durationStr} · ${tokensStr}`),
        ),
      );
    }),
    // 焦点提示
    isFocused
      ? React.createElement(Text, { dimColor: true }, '↑ ↓ Select · Enter View · Esc Return')
      : null,
  );
}
