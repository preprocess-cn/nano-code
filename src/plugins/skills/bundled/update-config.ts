import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Update Config 技能 — 配置管理。
 *
 * 对齐 Claude Code update-config 技能。指导 LLM 修改 nano-code 的 YAML 配置。
 */
export function createUpdateConfigSkill(): BundledSkillDef {
  return {
    name: 'update-config',
    description: '更新 nano-code 的配置文件（权限、钩子、环境变量等）',
    whenToUse: 'use when the user asks to modify configuration, permissions, or environment variables',
    getPrompt: async (args) => {
      return `# Update Config: 配置管理

管理 nano-code 的 YAML 配置文件。

## 配置文件位置
- **全局配置**: ~/.nano-code/config.yaml
- **项目配置**: .nano-code.yaml（当前工作目录）

## 配置格式
\`\`\`yaml
core:
  model: gpt-4o          # LLM 模型名
  maxTokens: 128000      # 最大 token 数
  defaultTimeout: 120000 # 工具执行超时（ms）

plugins:
  plugin-name:
    enabled: true|false  # 是否启用
    settings: {}         # 插件特定设置

skills:
  disabled:              # 禁用的技能列表
    - debug
    - stuck
  disableSkillTool: false # 完全禁用 skill 工具

system_prompt:
  with_tools: |          # 有工具时的提示词模板
    你是一个名为 nano-code 的 {role}...
  no_tools: |            # 无工具时的提示词模板
    你是一个名为 nano-code 的 {role}...
\`\`\`

## 规则
1. 修改前先使用 \`view_file_content\` 读取配置文件
2. 使用 \`patch_file\` 做精确修改，或 \`write_file_content\` 完全重写
3. 修改后通知用户：配置变更需要重启 nano-code 生效
4. 默认为 YAML 格式，注意保持缩进正确

${args ? `\n## 用户需求\n\n${args}` : ''}`;
    },
  };
}
