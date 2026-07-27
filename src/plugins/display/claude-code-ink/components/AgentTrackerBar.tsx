import React from 'react';
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js';
import type { AgentRuntimeState } from '#src/plugins/display/claude-code-ink/InkApp.js';

interface AgentTrackerBarProps {
  states: AgentRuntimeState[];
  agentColorMap?: Record<string, string>;
  currentView?: string;
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
 */
export function AgentTrackerBar({
  states,
  agentColorMap,
  currentView,
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
    React.createElement(
      Box,
      { height: 1 },
      React.createElement(Text, null,
        React.createElement(Text, { color: isViewingMain ? BASE_COLOR : undefined, dimColor: !isViewingMain },
          `${isViewingMain ? '●' : '○'} `),
        React.createElement(Text, { color: BASE_COLOR, bold: isViewingMain }, 'main'),
      ),
    ),
    // 子 agent 行
    ...running.map((s, i) => {
      const isViewing = currentView === s.fullName;
      const agentColor = agentColorMap?.[s.fullName] || '#06b6d4';
      const bullet = isViewing ? '●' : '○';
      const durationStr = formatDuration(s);
      const tokensStr = formatTokens(s.tokens);

      return React.createElement(
        Box,
        { key: s.fullName, height: 1, flexDirection: 'row' },
        React.createElement(Text, null,
          React.createElement(Text, { color: isViewing ? agentColor : undefined, dimColor: !isViewing }, `${bullet} `),
          React.createElement(Text, { color: agentColor, bold: isViewing }, s.type),
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
    React.createElement(Text, { dimColor: true }, 'Tab 切换 Agent 导航'),
  );
}
