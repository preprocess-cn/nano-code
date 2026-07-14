import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';
import { createCodeReviewSkill } from '#src/plugins/skills/bundled/code-review.js';

/**
 * Simplify 技能 — 代码审查与自动清理。
 *
 * simplify = code-review + --fix
 * 委托给 code-review 的核心 prompt，追加自动修复阶段。
 */
export function createSimplifySkill(): BundledSkillDef {
  const codeReview = createCodeReviewSkill('# Simplify: Code Review and Cleanup');
  return {
    name: 'simplify',
    description: 'Review code changes and auto-fix issues',
    whenToUse: 'use when the user asks to simplify, clean up, or review code changes',
    getPrompt: async (args, ctx) => {
      const base = await codeReview.getPrompt(args, ctx);
      return (
        base +
        '\n\n## Applying fixes (--fix)\n\nAfter producing the findings list, apply each finding directly to the working tree — correctness bugs and reuse/simplification/efficiency cleanups alike. Skip any finding whose fix would change intended behavior, require changes well outside the reviewed diff, or that you judge to be a false positive — note the skip rather than arguing with it. Finish with a brief summary of what was fixed and what was skipped.'
      );
    },
  };
}
