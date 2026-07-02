import type { BundledSkillDef } from '#src/plugins/skills/bundled/index.js';

/**
 * Keybindings 技能 — 快捷键说明。
 *
 * 对齐 Claude Code keybindings 技能。userInvocable=false（从 UI 隐藏）。
 * nano-code 无独立快捷键系统，仅提供终端快捷键说明。
 */
export function createKeybindingsSkill(): BundledSkillDef {
  return {
    name: 'keybindings',
    description: '快捷键自定义说明',
    whenToUse: 'use when the user asks about keybindings or keyboard shortcuts',
    userInvocable: false,
    getPrompt: async () => {
      return `# Keybindings: 快捷键说明

nano-code 运行在终端中，快捷键由终端模拟器管理，无独立快捷键绑定系统。

## 常用终端快捷键
| 操作 | 快捷键 |
|------|--------|
| 复制 | Ctrl+Shift+C |
| 粘贴 | Ctrl+Shift+V |
| 中断当前操作 | Ctrl+C |
| 搜索历史命令 | Ctrl+R |
| 清屏 | Ctrl+L |
| 行首 | Ctrl+A |
| 行尾 | Ctrl+E |
| 向前删词 | Alt+D |
| 删除整行 | Ctrl+U |

## 自定义
可自定义的 nano-code 行为通过配置文件 .nano-code.yaml 实现，
例如修改默认模型、超时时间等。`;
    },
  };
}
