import type { BundledSkillDef } from './index.js';

/**
 * Skillify 技能 — 从对话创建技能。
 *
 * 对齐 Claude Code skillify 技能。简化版：
 * 从对话历史提取模式，创建 SKILL.md 到技能目录。
 */
export function createSkillifySkill(): BundledSkillDef {
  return {
    name: 'skillify',
    description: '从当前对话创建可复用的技能（SKILL.md）',
    disableModelInvocation: true,
    argumentHint: '[技能名称/描述]',
    getPrompt: async (args) => {
      return `# Skillify: 从对话创建技能

基于当前对话和用户输入，创建可复用的 SKILL.md 技能文件。

## 步骤

1. **分析会话** — 回顾对话中用户反复执行的操作流程
2. **提炼模式** — 提取可重复的步骤序列作为技能内容
3. **确定元数据** — 技能名称、描述、使用场景
4. **创建 SKILL.md** — 写入 ~/.nano-code/skills/<name>/SKILL.md

## SKILL.md 格式
\`\`\`markdown
---
name: <技能名>
description: <简短描述>
context: inline
---

# <技能名>

## 使用场景
<何时使用此技能>

## 步骤
1. <步骤1>
2. <步骤2>
...
\`\`\`

${args ? `\n## 描述\n\n${args}` : ''}`;
    },
  };
}
