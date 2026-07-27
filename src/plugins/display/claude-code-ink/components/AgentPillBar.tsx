import React from 'react'
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js'

type Props = {
  agents: { name: string; label: string }[]
  agentColorMap: Record<string, string>
  selectedIndex: number
  currentView?: string
  isFocused: boolean
}

export function AgentPillBar({ agents, agentColorMap, selectedIndex: _selectedIndex, currentView, isFocused }: Props): React.ReactElement | null {
  if (agents.length === 0) return null

  return React.createElement(Box, { flexDirection: 'row', gap: 1, paddingLeft: 1, paddingRight: 1 },
    ...agents.map((agent) => {
      const isActive = agent.name === currentView
      const color = agentColorMap[agent.name]
      const dim = !isActive
      return React.createElement(
        Text,
        { key: agent.name, color, dimColor: dim, bold: isFocused && isActive, inverse: isActive },
        `${isActive ? '❯ ' : ''}${agent.label}`,
      )
    }),
  )
}
