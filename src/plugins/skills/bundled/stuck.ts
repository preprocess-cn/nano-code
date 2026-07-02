import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Stuck 技能 — 卡住会话诊断。
 *
 * 对齐 Claude Code stuck 技能。适配 nano-code：
 * 诊断当前进程状态、日志文件、会话状态。
 * 移除 Claude Code 特有的 Slack 集成和多会话扫描。
 */
export function createStuckSkill(): BundledSkillDef {
  return {
    name: 'stuck',
    description: '诊断卡住的会话 — 检查进程和日志状态',
    disableModelInvocation: true,
    getPrompt: async () => {
      return `# Stuck: 卡住会话诊断

## 诊断步骤

1. **检查工作目录状态**
   - 当前工作目录中是否有未完成的操作
   - 检查 .nano-code-session.json 了解会话状态

2. **检查进程状态**
   - 使用 \`run_bash_command\` 检查当前 nano-code 进程（通过 PID $$）的状态
   - 检查是否存在卡住的子进程（ps aux | grep nano-code）

3. **回顾对话上下文**
   - 最近的用户请求是什么
   - 上一个执行的工具是什么，是否正常返回
   - 是否有异常中断的迹象

4. **输出诊断报告**
   按以下格式输出：

   ### 诊断报告
   - 工作目录状态: [正常/异常]
   - 进程状态: [正常/卡住]
   - 子进程: [无/有（详情）]
   - 会话状态: [活跃/会话文件异常]

   ### 问题总结
   [总结发现的问题]

   ### 建议操作
   - [如果卡住] 建议重启会话或清理进程
   - [如果正常] 建议继续当前任务`;
    },
  };
}
