import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Review 技能 — Pull Request 代码审查。
 *
 * 对齐 Claude Code 的 `/review` command：
 * 1. gh pr list 列出 PR
 * 2. gh pr view + gh pr diff 获取变更
 * 3. 自由格式分析
 *
 * 无 7-angle/verify/JSON 输出（那是 /code-review 的功能）。
 */
export function createReviewSkill(): BundledSkillDef {
  return {
    name: 'review',
    description: 'Review pull request or local code changes',
    argumentHint: '[PR number]',
    whenToUse: 'use when the user asks to review a pull request',
    getPrompt: async (args) => {
      const hasPrArg = args && /^\d+$/.test(args.trim());
      const prNumber = hasPrArg ? args.trim() : '';

      return `You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
      2. If a PR number is provided, run \`gh pr view <number> --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels\` to get PR details
      3. Run \`gh pr diff <number>\` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any potential issues or risks

      Keep your review concise but thorough. Focus on:
      - Code correctness
      - Following project conventions
      - Performance implications
      - Test coverage
      - Security considerations

      Format your review with clear sections and bullet points.

      PR number: ${prNumber}`;
    },
  };
}
