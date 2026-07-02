import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Debug 技能 — 调试诊断。
 *
 * 对齐 Claude Code debug 技能。disableModelInvocation=true，
 * 用户必须主动 /debug 调用。读取日志尾部、分析错误。
 */
export function createDebugSkill(): BundledSkillDef {
  return {
    name: 'debug',
    description: '获取调试帮助 — 分析日志、诊断问题',
    disableModelInvocation: true,
    argumentHint: '[问题描述]',
    getPrompt: async (args) => {
      return `# Debug Skill: 调试诊断

## 问题描述
${args || '用户未描述具体问题。请查看对话历史中的报错信息并分析。'}

## 诊断步骤
1. **检视上下文** — 回顾本对话中最近的工具调用结果，检查是否有错误信息
2. **分析错误** — 识别错误类型（编译错误、运行时异常、网络超时等）
3. **定位根因** — 分析错误堆栈、输出日志中的关键信息
4. **给出修复** — 提供具体的修复建议或后续排查步骤

## 规则
- 仔细阅读 \`run_bash_command\` 的返回结果中的错误信息
- 区分语法错误、逻辑错误和运行时异常
- 如果信息不足，提议使用更详细的日志或调试工具`;
    },
  };
}
