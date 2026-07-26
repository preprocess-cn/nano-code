import React, { useContext, useState } from 'react'
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js'
import { ScrollChromeContext, type StickyPrompt } from './ScrollChromeContext.js'

const STICKY_TEXT_CAP = 500

/**
 * Collapse text to first paragraph, cap length, normalize whitespace.
 */
function collapseText(raw: string): string {
  const trimmed = raw.trimStart()
  const paraEnd = trimmed.search(/\n\s*\n/)
  return (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed)
    .slice(0, STICKY_TEXT_CAP)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * StickyPromptHeader — a 1-row header rendered ABOVE the ScrollBox.
 *
 * It becomes visible when the user scrolls backward past the most recent user
 * prompt. Clicking the header scrolls back to that prompt and temporarily
 * hides the header (via the 'clicked' sentinel) so the content doesn't jump.
 */
export function StickyPromptHeader(): React.ReactElement | null {
  const { setStickyPrompt } = useContext(ScrollChromeContext)
  const [sticky, setStickyInternal] = useState<StickyPrompt | null>(null)

  // The ScrollChromeContext setter is a bit awkward here — in CC this component
  // lives in FullscreenLayout which OWNS the state. Here we need a different
  // approach: either lift state up to InkApp, or use a different pattern.
  //
  // For now we export a helper hook that InkApp can use to wire this up.

  // We expose setStickyPrompt which will be called by StickyTracker inside
  // VirtualMessageList. InkApp owns the state via useState and passes it
  // through ScrollChromeContext.Provider.

  return null // rendered by InkApp
}

/**
 * Render the actual sticky header row.
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