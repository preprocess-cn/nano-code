import { createContext } from 'react'

/**
 * StickyPrompt represents the sticky header state.
 * - `{ text, scrollTo }`: Show a sticky header with the given text. Clicking
 *   calls scrollTo to jump to that prompt.
 * - `'clicked'`: Sentinel value — hide the header temporarily after a click
 *   while keeping the ScrollBox padding collapsed so the content row that
 *   was hidden under the header becomes visible without a jump.
 */
export type StickyPrompt =
  | { text: string; scrollTo: () => void }
  | 'clicked'

export const ScrollChromeContext = createContext<{
  setStickyPrompt: (p: StickyPrompt | null) => void
}>({ setStickyPrompt: () => {} })