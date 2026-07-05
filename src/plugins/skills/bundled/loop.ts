import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

export function createLoopSkill(): BundledSkillDef {
  return {
    name: 'loop',
    description: '创建定时循环任务 — 让 AI 定期执行指定操作',
    whenToUse: 'use when the user wants to run a task on a recurring schedule',
    argumentHint: '[间隔] <prompt>',
    disableModelInvocation: true,
    userInvocable: true,
    getPrompt: async (_args: string, _ctx: { cwd: string }): Promise<string> => {
      return `# Loop: 创建定时循环任务

您可以通过 \`/loop\` 命令创建定时任务，让 AI 定期执行指定操作。

## 用法

\`\`\`
/loop <间隔> "<prompt>"
\`\`\`

## 示例

- \`/loop 5m "检查服务器健康状态"\` — 每 5 分钟检查一次
- \`/loop 1h "代码审查队列"\` — 每小时检查代码审查
- \`/loop */5 * * * * "执行定时任务"\` — 使用标准 cron 表达式

## 支持的间隔格式

- \`30s\` — 每 30 秒（最短 5 秒，使用 6 字段 cron）
- \`5m\` — 每 5 分钟
- \`1h\` — 每小时
- 标准 5 字段 cron 表达式

## 管理定时任务

- \`cron_list\` — 列出所有定时任务
- \`cron_delete\` — 删除指定任务

## 限制

- 最多 50 个定时任务
- 循环任务 7 天后自动过期
- 跨会话持久化需使用 cron_create 工具的 durable 参数`;
    },
  };
}
