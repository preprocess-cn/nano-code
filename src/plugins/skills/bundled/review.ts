import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Review 技能 — 代码审查。
 *
 * 对齐 Claude Code 的 `/review` command。
 * 支持两种模式：
 * 1. PR 审查（args 含 PR 编号）：通过 gh CLI 获取 PR 信息与 diff
 * 2. 本地审查（无 args）：通过 git diff 审查工作区变更
 *
 * 与 simplify 的关系：
 * - simplify = review + auto-fix
 * - review = 只审查不修改，输出结构化报告
 */
export function createReviewSkill(): BundledSkillDef {
  return {
    name: 'review',
    description: '审查当前代码变更的正确性、性能和安全性',
    aliases: ['code-review'],
    argumentHint: '[PR 编号 | 额外关注点]',
    whenToUse: 'use when the user asks to review, audit, or check code changes',
    getPrompt: async (args) => {
      const hasPrArg = args && /^\d+$/.test(args.trim());

      if (hasPrArg) {
        return `# Review: Pull Request 审查

你是一位专业的代码审查者。按以下步骤执行：

## 步骤 1: 获取 PR 信息

1. 运行 \`gh pr view ${args.trim()}\` 获取 PR 详情（标题、描述、标签等）
2. 运行 \`gh pr diff ${args.trim()}\` 获取 PR 的完整 diff

## 步骤 2: 分析变更

审查时重点关注：

- **代码正确性** — 逻辑错误、竞态条件、边界情况、类型安全、异步处理
- **项目约定** — 是否符合现有代码风格和架构模式
- **性能影响** — 不必要的循环、大对象复制、N+1 查询、内存泄漏
- **测试覆盖** — 变更是否有对应测试，边界情况是否覆盖
- **安全考虑** — 命令注入、路径遍历、敏感信息泄露、输入校验缺失

## 步骤 3: 输出审查报告

用清晰的章节和要点组织你的审查，包含以下部分：

### 概述
- PR 做了什么
- 变更范围和规模

### 代码质量与风格
- 是否符合项目约定
- 可读性和可维护性

### 改进建议
- 每个建议包含文件路径和具体改进方案

### 潜在风险
- 可能导致问题的变更
- 遗漏的边界情况

严重度分三级：
- **CRITICAL** — 可能导致数据丢失、安全漏洞或生产故障
- **WARNING** — 可能导致错误行为或显著性能问题
- **SUGGESTION** — 代码质量改进建议`;
      }

      return `# Review: 本地代码审查

你是一位专业的代码审查者。按以下步骤执行：

## 步骤 1: 获取变更

运行 \`run_bash_command\` 工具执行 \`git diff\`（有暂存区更改时用 \`git diff --cached\`，否则用 \`git diff HEAD\`）识别所有变更文件。
如果没有 git 变更或当前不在 git 仓库中，说明无需审查的变更。

## 步骤 2: 分析变更

审查时重点关注：

- **代码正确性** — 逻辑错误、竞态条件、边界情况、类型安全、异步处理
- **项目约定** — 是否符合现有代码风格和架构模式
- **性能影响** — 不必要的循环、大对象复制、N+1 查询、内存泄漏
- **测试覆盖** — 变更是否有对应测试，边界情况是否覆盖
- **安全考虑** — 命令注入、路径遍历、敏感信息泄露、输入校验缺失

${args ? `## 额外关注点\n\n${args}\n` : ''}

## 步骤 3: 输出审查报告

按文件分组，用清晰的章节和要点组织：

### <文件路径>

- [严重度] 描述 — 修复建议

### 总结
列出所有发现的问题数量和严重度分布。

严重度分三级：
- **CRITICAL** — 可能导致数据丢失、安全漏洞或生产故障
- **WARNING** — 可能导致错误行为或显著性能问题
- **SUGGESTION** — 代码质量改进建议

如果没有发现问题，请明确说明"未发现问题"。`;
    },
  };
}
