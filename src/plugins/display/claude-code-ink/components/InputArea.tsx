import React from 'react'
import { Box, Text } from '#src/plugins/display/claude-code-ink/ink.js'
import type { DOMElement } from '#src/plugins/display/claude-code-ink/engine/dom.js'
import { SearchBox } from '#src/plugins/display/claude-code-ink/SearchBox.js'
import type { CommandSuggestion } from '#src/plugins/display/claude-code-ink/InkApp.js'

interface InputAreaProps {
  searchMode: 'inactive' | 'active' | 'persistent'
  searchQuery: string
  searchCursorPos: number
  searchMatchCount: number
  searchCurrentIdx: number
  transcriptMode: boolean
  cursorRef: (el: DOMElement | null) => void
  renderedLines: string[]
  inputBorderColor: string
  visibleSuggestions: CommandSuggestion[]
  selectedSuggestionIndex: number
  isAtPrefix: boolean
  suggestionWindowStart: number
}

/**
 * Shared input area rendered in both the welcome page and the normal
 * conversation view. Encapsulates:
 * - The prompt border row (SearchBox / transcript hint / > input)
 * - The suggestion popup below it
 */
export function InputArea({
  searchMode,
  searchQuery,
  searchCursorPos,
  searchMatchCount,
  searchCurrentIdx,
  transcriptMode,
  cursorRef,
  renderedLines,
  inputBorderColor,
  visibleSuggestions,
  selectedSuggestionIndex,
  isAtPrefix,
  suggestionWindowStart,
}: InputAreaProps): React.ReactElement {
  return React.createElement(React.Fragment, null,
    // Prompt input (replaced by SearchBox during search)
    React.createElement(
      Box,
      {
        flexDirection: 'row',
        alignItems: 'flex-start',
        borderStyle: 'round',
        borderColor: searchMode === 'active' ? '#7c3aed' : inputBorderColor,
        borderLeft: false, borderRight: false, borderBottom: true,
        width: '100%',
      },
      searchMode === 'active'
        ? React.createElement(SearchBox, {
            query: searchQuery,
            cursorPos: searchCursorPos,
            matchCount: searchMatchCount,
            currentMatch: searchCurrentIdx,
          })
        : transcriptMode
          ? React.createElement(Text, { dimColor: true }, 'Transcript · / to search · q to exit')
          : React.createElement(React.Fragment, null,
              React.createElement(Text, { bold: true, color: '#9ca3af' }, '> '),
              React.createElement(
                Box,
                { ref: cursorRef, flexDirection: 'column', flexGrow: 1 },
                ...renderedLines.map((line, i) =>
                  React.createElement(Text, { key: i }, line || ' '),
                ),
              ),
            ),
    ),
    // Suggestion popup (hidden during search)
    searchMode === 'inactive' && visibleSuggestions.length > 0
      ? React.createElement(
          Box,
          { flexDirection: 'column', paddingLeft: 2, paddingTop: 1 },
          ...visibleSuggestions.map((s, i) => {
            const actualIndex = suggestionWindowStart + i;
            const isFocused = actualIndex === selectedSuggestionIndex;
            return React.createElement(Text, {
              key: s.name,
              color: isFocused ? '#7c3aed' : s.type === 'agent' ? '#06b6d4' : undefined,
              dimColor: !isFocused,
            }, `${isFocused ? '● ' : '○ '}${isAtPrefix ? '@' : '/'}${s.name}  ${s.type === 'agent' ? '[agent] ' : ''}${s.description}`);
          }),
        )
      : null,
  )
}
