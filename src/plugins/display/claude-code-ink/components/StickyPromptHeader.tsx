import React, { useState } from 'react'
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js'

const STICKY_TEXT_CAP = 500

function collapseText(raw: string): string {
  const trimmed = raw.trimStart()
  const paraEnd = trimmed.search(/\n\s*\n/)
  return (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed)
    .slice(0, STICKY_TEXT_CAP)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Render the sticky header row.
 * Called by InkApp when stickyPrompt is non-null and not 'clicked'.
 */
export function StickyPromptHeaderRow({
  prompt,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  prompt: { text: string; scrollTo: () => void }
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.ReactElement {
  const [hover, setHover] = useState(false)

  return React.createElement(
    Box,
    {
      flexShrink: 0,
      width: '100%',
      height: 1,
      paddingRight: 1,
      backgroundColor: hover ? 'userMessageBackgroundHover' : 'userMessageBackground',
      onClick,
      onMouseEnter: () => { setHover(true); onMouseEnter() },
      onMouseLeave: () => { setHover(false); onMouseLeave() },
    },
    React.createElement(
      Text,
      { color: 'subtle', wrap: 'truncate-end' },
      `> ${collapseText(prompt.text)}`,
    ),
  )
}