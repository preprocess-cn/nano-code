import type { UIMessage } from '../InkApp.js'

/**
 * Strip system-reminder blocks from text.
 * These are prepended by the runtime for context updates but aren't part of
 * what the user typed.
 */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

/**
 * Extract searchable text from a UIMessage.
 * Returns the lowered string for indexOf matching, or null if the message
 * should be skipped in search results.
 *
 * All message kinds are searchable except turnComplete (timestamps only).
 * This ensures navigation results align with what's visually highlighted
 * on screen by ink.setSearchHighlight (which searches all rendered text).
 */
export function extractSearchText(msg: UIMessage): string | null {
  if (msg.kind === 'turnComplete') return null

  const cleaned = stripSystemReminders(msg.text)
  if (!cleaned || cleaned.startsWith('<')) return null

  return cleaned.toLowerCase()
}

/**
 * Pre-lower and cache search text for every message.
 * Returns elapsed ms, or 0 if cache was already warm.
 */
export function warmSearchCache(messages: UIMessage[]): number {
  // In CC this is a WeakMap-based cache. For nano-code we use a simple
  // approach: just return 0 since we compute on-the-fly.
  // A production implementation should cache results keyed by message identity.
  return 0
}