import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Review 技能 — 代码审查。
 *
 * 与 simplify 的关系：
 * - simplify = review + auto-fix
 * - review = 只审查不修改，输出结构化报告
 */
export function createReviewSkill(): BundledSkillDef {
  return {
    name: 'review',
    description: '审查当前代码变更的正确性、性能和安全性',
    whenToUse: 'use when the user asks to review, audit, or check code changes',
    getPrompt: async (args) => {
      return `# Review: 代码审查

运行 \`run_bash_command\` 工具执行 \`git diff\`（有暂存区更改时用 \`git diff --cached\`）识别所有变更文件。
如果没有 git 变更或当前不在 git 仓库中，说明无需审查的变更。

${args ? `## 重点关注\n\n${args}\n` : ''}

## 审查维度

对每个变更文件，从以下维度审查：

1. **正确性** — 逻辑错误、竞态条件、边界情况、类型安全、异步处理
2. **性能** — 不必要的循环、大对象复制、N+1 查询、内存泄漏
3. **安全** — 命令注入、路径遍历、敏感信息泄露、输入校验缺失

## 输出格式

按文件分组，每个发现的格式：

\`\`\`
### <文件路径>
- [严重度] 描述 — 修复建议
\`\`\`

严重度分三级：
- **CRITICAL** — 可能导致数据丢失、安全漏洞或生产故障
- **WARNING** — 可能导致错误行为或显著性能问题
- **SUGGESTION** — 代码质量改进建议

如果没有发现问题，请明确说明"未发现问题"。`;
    },
  };
}
