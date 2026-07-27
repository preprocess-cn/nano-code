import React, { useContext, useState, useEffect } from 'react';
import { Box, Text, stringWidth, wrapText } from '#src/plugins/display/claude-code-ink/ink.js';
import { TerminalSizeContext } from '#src/plugins/display/claude-code-ink/engine/components/TerminalSizeContext.js';
import { formatDuration, formatTokens } from '#src/utils/format.js';
import { debugLog } from '#src/plugins/display/claude-code-ink/utils/debugLog.js';
import type { AgentRuntimeState } from '#src/plugins/display/claude-code-ink/InkApp.js';

interface AgentTrackerBarProps {
  states: AgentRuntimeState[];
  agentColorMap?: Record<string, string>;
  currentView?: string;
  selectedIndex?: number;
  isFocused?: boolean;
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

  const terminalSize = useContext(TerminalSizeContext);
  const columns = terminalSize?.columns ?? process.stdout.columns ?? 80;
  const isViewingMain = !currentView;
  const BASE_COLOR = '#06b6d4';

  // 运行中的 agent 每秒更新一次持续时间，避免每次 render（如 stream chunk）都重算布局
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (running.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running.length]);

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
    // 子 agent 行（CC 风格：手动计算宽度截断 query/description）
    ...running.map((s, i) => {
      const listIdx = i + 1;
      const isViewing = currentView === s.fullName;
      const isSelected = isFocused && selectedIndex === listIdx;
      const agentColor = agentColorMap?.[s.fullName] || BASE_COLOR;
      const bullet = isViewing ? '●' : '○';
      const end = s.status === 'running' ? now : (s.endTime ?? now);
      const durationStr = formatDuration(Math.max(0, end - s.startTime));
      const tokensStr = formatTokens(s.tokens);

      // CC 风格：计算可用宽度，截断 query/description
      const prefixWidth = stringWidth(`${bullet} ${s.type}`);
      const suffixStr = `  ${durationStr} · ${tokensStr}`;
      const suffixWidth = stringWidth(suffixStr);
      let middleText = '';
      if (s.query && s.description) {
        middleText = ` · ${s.query} · ${s.description}`;
      } else if (s.query) {
        middleText = ` · ${s.query}`;
      } else if (s.description) {
        middleText = ` · ${s.description}`;
      }
      const availableWidth = columns - prefixWidth - suffixWidth;
      const truncated = middleText && stringWidth(middleText) > Math.max(0, availableWidth)
        ? wrapText(middleText, Math.max(0, availableWidth), 'truncate-end')
        : middleText;

      debugLog(
        `AgentTrackerBar ${s.fullName}: cols=${columns}` +
        ` prefix=${prefixWidth} suffix=${suffixWidth} available=${availableWidth}` +
        ` middleLen=${stringWidth(middleText)} truncatedLen=${stringWidth(truncated)}` +
        ` query=${s.query?.length} desc=${s.description?.length}`,
      );

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
          truncated
            ? React.createElement(Text, { dimColor: true }, truncated)
            : null,
          React.createElement(Text, { dimColor: true }, suffixStr),
        ),
      );
    }),
    // 焦点提示
    isFocused
      ? React.createElement(Text, { dimColor: true }, '↑ ↓ Select · Enter View · Esc Return')
      : null,
  );
}
