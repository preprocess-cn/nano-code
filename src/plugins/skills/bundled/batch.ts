import type { BundledSkillDef } from './index.js';

/**
 * Batch 技能 — 并行工作编排。
 *
 * 对齐 Claude Code batch 技能。disableModelInvocation=true，
 * 用户主动 /batch <指令> 调用。移除了 Claude Code 特有的 worktree/PR 指令，
 * 保留计划→并行 Worker→跟踪进度的核心结构。
 */
export function createBatchSkill(): BundledSkillDef {
  return {
    name: 'batch',
    description: '将大指令拆分为并行 Worker 执行',
    disableModelInvocation: true,
    argumentHint: '<指令>',
    getPrompt: async (args) => {
      if (!args || !args.trim()) {
        return '## 错误：请提供要批量执行的指令\n\n用法：batch("为所有模块添加单元测试")\n\n示例：\n- batch("重构所有工具插件的错误处理")\n- batch("为所有 API 端点添加请求日志")';
      }

      return `# Batch: 并行工作编排

## 用户指令
${args}

## Phase 1: 研究和计划
在开始执行前，充分理解指令范围：

1. **理解范围** — 分析指令包含哪些独立的工作单元
2. **拆分为工作单元** — 每个单元应是自包含的，可独立完成的任务（5-30 个）
3. **确定验证方案** — 定义如何端到端验证每个单元的结果

## Phase 2: 启动并行 Worker
为每个工作单元调用 \`run_agent\` 并行执行。
每个 worker 的 prompt 必须包含：
- 整体项目上下文
- 该单元的具体任务描述
- 预期的输出格式

## Phase 3: 跟踪进度
- 记录所有 Worker 的执行状态（运行中/完成/失败）
- Worker 完成后，检查结果质量
- 全部完成后汇总最终结果`;
    },
  };
}
