import type { BundledSkillDef } from './index.js';

/**
 * Verify 技能 — 验证代码变更确实按预期工作。
 *
 * 对齐 Claude Code 的 verify 技能模式。由于原始 SKILL.md 不可用
 *（构建时内联），根据注册逻辑重构 prompt 结构。
 */
export function createVerifySkill(): BundledSkillDef {
  return {
    name: 'verify',
    description: '验证代码变更确实按预期工作',
    whenToUse: 'use when the user asks to verify code changes or confirm functionality',
    getPrompt: async (args) => {
      return `# Verify: 验证代码变更

分析当前变更并验证其正确性。

## 步骤
1. **理解变更** — 运行 \`run_bash_command\` 执行 \`git diff\` 查看具体修改
2. **确定验证策略** — 根据变更类型选择合适的验证方式：
   - 运行项目测试（\`npm test\`、\`go test\` 等）
   - 构建项目验证编译通过
   - 运行特定命令观察行为
3. **执行验证** — 使用 \`run_bash_command\` 执行验证
4. **报告结果** — 说明验证是否通过。未通过时给出详细分析和修复建议

${args ? `\n## 用户需求\n\n${args}` : ''}`;
    },
  };
}
