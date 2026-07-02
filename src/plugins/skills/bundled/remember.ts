import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Remember 技能 — 记忆管理。
 *
 * 对齐 Claude Code remember 技能。指导 LLM 检视 nano-code 的记忆存储
 *（save_memory / recall_memory 工具），审查、分类、清理记忆条目。
 * 无 CLAUDE.md 概念 → 改为推荐写入 AGENT.md。
 */
export function createRememberSkill(): BundledSkillDef {
  return {
    name: 'remember',
    description: '管理持久记忆 — 审查、分类、清理记忆条目',
    whenToUse: 'use when the user mentions memory or asks to remember/forget something',
    getPrompt: async (args) => {
      return `# Memory Review: 记忆管理

审查当前的持久记忆，生成按操作类型分组的建议变更报告。

## 步骤

### 1. 收集记忆
使用 \`recall_memory\` 工具检索现有的全部记忆条目。

### 2. 分类与清理
检视每条记忆，识别：
- **重复条目** — 多条内容相似或相同的记忆 → 建议合并
- **过期条目** — 引用已过时信息或已完成任务的记忆 → 建议删除
- **冲突条目** — 相互矛盾的记忆 → 标记供用户确认
- **值得保留** — 在对话中多次被引用的重要事实 → 建议保留

### 3. 推荐升级
有价值的记忆建议写入 AGENT.md 项目文件，成为持久指令：

### 4. 呈现报告
按操作类型分组的结构化报告：
1. **待清理** — 重复/过期条目
2. **待确认** — 冲突或不确定的条目
3. **建议保留** — 当前记忆中的高质量条目

## 规则
- 在修改前呈现所有建议供用户批准
- 未经用户明确同意不得修改记忆
- 不猜测含义不清的条目

${args ? `\n## 额外上下文\n\n${args}` : ''}`;
    },
  };
}
