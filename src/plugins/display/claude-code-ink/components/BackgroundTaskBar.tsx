import React from 'react';
import { Box, Text } from '../ink.js';
import type { BackgroundTaskInfo } from '../InkApp.js';

interface BackgroundTaskBarProps {
  tasks: BackgroundTaskInfo[];
}

export function BackgroundTaskBar({ tasks }: BackgroundTaskBarProps): React.ReactElement | null {
  if (!tasks || tasks.length === 0) return null;

  const statusColor = (status: string): string | undefined => {
    switch (status) {
      case 'running': return '#06b6d4';   // cyan
      case 'completed': return '#22c55e';  // green
      case 'error': return '#ef4444';      // red
      default: return undefined;
    }
  };

  const statusIcon = (status: string): string => {
    switch (status) {
      case 'running': return '○';
      case 'completed': return '✓';
      case 'error': return '✗';
      default: return '?';
    }
  };

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingLeft: 1, paddingBottom: 1 },
    React.createElement(Text, { dimColor: true }, '── 后台任务 ──────────────────────────'),
    ...tasks.map((t) =>
      React.createElement(
        Box,
        { key: t.taskId, height: 1 },
        React.createElement(
          Text,
          { color: statusColor(t.status), dimColor: t.status === 'completed' },
          `${statusIcon(t.status)} ${t.agentName} (${t.taskId})  ${t.message}`,
        ),
      ),
    ),
  );
}
