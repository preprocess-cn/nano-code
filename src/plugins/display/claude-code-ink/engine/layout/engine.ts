import type { LayoutNode } from '#src/plugins/display/claude-code-ink/engine/layout/node.js'
import { createYogaLayoutNode } from '#src/plugins/display/claude-code-ink/engine/layout/yoga.js'

export function createLayoutNode(): LayoutNode {
  return createYogaLayoutNode()
}
