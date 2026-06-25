import type { BundledSkillDef } from './index.js';

/**
 * Simplify 技能 — 代码审查与自动清理。
 *
 * 对齐 Claude Code 的 `SIMPLIFY_PROMPT`，三阶段结构：
 * 1. git diff 识别变更
 * 2. 多维度审查（代码复用、质量、效率）
 * 3. 聚合修复
 */
export function createSimplifySkill(): BundledSkillDef {
  return {
    name: 'simplify',
    description: '审查代码变更并自动修复问题',
    whenToUse: 'use when the user asks to simplify, clean up, or review code changes',
    getPrompt: async (args) => {
      return `# Simplify: 代码审查与清理

运行 \`run_bash_command\` 工具执行 \`git diff\`（有暂存区更改时用 \`git diff HEAD\`）识别所有变更文件。
如果没有 git 变更，则审查本对话中最近编辑过的文件。

## Phase 1: 变更识别
- 执行 git diff 获取变更列表
- 如果没有 git 仓库或没有变更，审查对话中最近修改的文件

## Phase 2: 多维度审查
并行审查每个变更文件（可多次调用 \`run_agent\`）：

1. **代码复用** — 搜索可用的工具/辅助函数，标记重复功能，标记可被现有工具替代的内联逻辑
2. **代码质量** — 检查冗余状态、参数膨胀、复制粘贴变体、抽象泄漏、不必要的注释
3. **效率** — 检查不必要的工作、遗漏的并发、热点路径膨胀、TOCTOU、内存问题

## Phase 3: 修复问题
汇总所有发现，逐个修复。误报或不值得处理的跳过即可。
最后简要总结修复内容。
${args ? `\n## 额外关注点\n\n${args}` : ''}`;
    },
  };
}
