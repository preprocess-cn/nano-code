import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * commit-pr 技能 — 提交变更并创建 Pull Request。
 *
 * 参考 Claude Code 的 /commit-push-pr 斜杠命令实现。
 * 包含提交、推送、PR 创建三阶段流程。
 */
export function createCommitPrSkill(): BundledSkillDef {
  return {
    name: 'commit-pr',
    description: '提交变更并创建 GitHub Pull Request',
    aliases: ['commitpr'],
    whenToUse: 'use when the user asks to commit, push, and create a pull request',
    getPrompt: async (args, ctx) => {
      const modelName = ctx.modelName ?? 'unknown';
      return `# Commit-PR: 提交变更并创建 Pull Request

使用 \`run_bash_command\` 工具执行以下步骤。

## 步骤 1: 检查 Git 状态

并行运行以下命令：
- \`git status\`
- \`git diff HEAD\`（查看所有变更）
- \`git branch --show-current\`（确认当前分支）
- \`git log --oneline -10\`（查看最近的提交风格）
- \`git remote -v\`（确认远程仓库配置）

如果当前不在 Git 仓库中，向用户说明并停止。

## 步骤 2: 处理分支

如果当前在默认分支（main/master），先创建并切换到新特性分支：
\`git checkout -b <描述性分支名>\`

## 步骤 3: 暂存变更

${args ? `用户要求/PR 描述：\n${args}\n\n` : ''}
- 使用 \`git add\` 添加相关文件
- 避免添加敏感文件或生成文件

## 步骤 4: 提交变更

使用 **HEREDOC 语法** 创建提交：

\`\`\`bash
git commit -m "$(cat <<'EOF'
<提交信息>

nano-code(${modelName})
EOF
)"
\`\`\`

- 提交信息第一行作为后续 PR 标题
- 末尾单独一行附归属标记 \`nano-code(${modelName})\`

## 步骤 5: 推送到远程

\`\`\`bash
git push -u origin <当前分支名>
\`\`\`

如果推送失败（如无远程权限），向用户说明并提供手动指令。

## 步骤 6: 创建 Pull Request

使用 GitHub CLI 创建 PR：

\`\`\`bash
gh pr create --title "<PR 标题>" --body "$(cat <<'EOF'
## Summary
<1-3 条变更要点>

## Test plan
<测试步骤>

nano-code(${modelName})
EOF
)"
\`\`\`

PR 标题从提交信息第一行提取，正文包含变更摘要和检查清单。

如果 \`gh\` CLI 不可用，提示用户手动创建 PR 并提供分支信息。

## 安全规则（必须遵守）
- 禁止 \`git commit --amend\`
- 禁止 \`git commit --no-verify\` 或任何跳过 hook 的标志
- 禁止 \`git push --force\` 或 \`git push --force-with-lease\`
- 只有用户明确要求时才执行整套流程`;
    },
  };
}
