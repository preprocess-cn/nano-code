import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * commit 技能 — 创建 Git 提交。
 *
 * 参考 Claude Code 的 /commit 斜杠命令实现。
 * 提交信息末尾自动附加 nano-code({model_name}) 归属标记。
 */
export function createCommitSkill(): BundledSkillDef {
  return {
    name: 'commit',
    description: '创建 Git 提交（附带 nano-code 归属信息）',
    whenToUse: 'use when the user asks to commit changes or create a git commit',
    getPrompt: async (args, ctx) => {
      const modelName = ctx.modelName ?? 'unknown';
      return `# Commit: 创建 Git 提交

使用 \`run_bash_command\` 工具执行以下步骤。

## 步骤 1: 检查 Git 状态

并行运行以下命令：
- \`git status\`
- \`git diff HEAD\`（查看所有未暂存和已暂存的变更）
- \`git branch --show-current\`（确认当前分支）
- \`git log --oneline -10\`（查看最近的提交风格）

如果当前不在 Git 仓库中，向用户说明并停止。

## 步骤 2: 暂存变更

${args ? `用户要求/提交信息：\n${args}\n\n` : ''}
- 如果已有暂存变更，使用 \`git diff --cached\` 查看具体内容
- 如果没有暂存变更，使用 \`git add\` 添加相关文件：
  - 优先按文件名添加（从 git status 中识别）
  - 避免添加 \`.env\`、\`credentials.json\` 等敏感文件
  - 避免添加大型生成文件或二进制文件

## 步骤 3: 提交变更

使用 **HEREDOC 语法** 创建提交（禁止 shell 变量展开）：

\`\`\`bash
git commit -m "$(cat <<'EOF'
<提交信息>

nano-code(${modelName})
EOF
)"
\`\`\`

要求：
- 提交信息 1-2 句话，关注"为什么"而非"是什么"
- 参考最近提交的格式风格
- 末尾单独一行附归属标记 \`nano-code(${modelName})\`

## 步骤 4: 验证

运行 \`git status\` 确认提交成功。

## 安全规则（必须遵守）
- 禁止 \`git commit --amend\`（除非用户明确要求）
- 禁止 \`git commit --no-verify\` 或任何跳过 hook 的标志
- 只有用户要求时才创建提交，不要擅自提交
- 无变更时不要创建空提交`;
    },
  };
}
