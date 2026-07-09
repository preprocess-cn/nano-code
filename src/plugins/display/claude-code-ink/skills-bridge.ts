import { getBundledSkills } from '#src/plugins/skills/bundled/index.js';
import { loadAllSkills } from '#src/plugins/skills/loader.js';
import { getBuiltinCommands } from '#src/plugins/commands/builtin.js';
import { loadAgentDefinitions } from '#src/plugins/coordinator/agent-loader.js';
import { setSuggestionProvider, type CommandSuggestion } from '#src/plugins/display/claude-code-ink/index.js';

/**
 * 初始化命令/技能建议列表。
 * 从技能系统和命令系统收集所有可用条目，提供给 Ink 显示层用于斜杠弹出。
 *
 * @param disabledSkills 用户配置中禁用的技能名称列表
 */
export function initCommandSuggestions(disabledSkills: string[]): void {
  setSuggestionProvider(() => {
    const items: CommandSuggestion[] = [];

    // 内置斜杠命令（exit, clear, help, context）
    for (const cmd of getBuiltinCommands()) {
      items.push({ name: cmd.name, description: cmd.description, type: 'builtin' });
      for (const alias of cmd.aliases ?? []) {
        items.push({ name: alias, description: `alias of ${cmd.name}`, type: 'builtin' });
      }
    }

    // 内置 TypeScript 技能（只显示用户可斜杠调用的）
    for (const s of getBundledSkills()) {
      if (s.userInvocable === false) continue;
      if (disabledSkills.includes(s.name)) continue;
      items.push({ name: s.name, description: s.description, type: 'skill' });
      for (const alias of s.aliases ?? []) {
        items.push({ name: alias, description: `alias of ${s.name}`, type: 'skill' });
      }
    }

    // 文件系统技能（SKILL.md）
    for (const s of loadAllSkills()) {
      if (disabledSkills.includes(s.name)) continue;
      items.push({ name: s.name, description: s.description, type: 'skill' });
    }

    // 工具型 agent（~/.nano-code/agents/）
    for (const a of loadAgentDefinitions()) {
      if (a.enabled === false) continue;
      items.push({ name: a.name, description: a.description, type: 'agent' });
    }
    // 主模式重置
    items.push({ name: 'main', description: '切换回主模式（默认 agent）', type: 'agent' });

    return items.sort((a, b) => a.name.localeCompare(b.name));
  });
}
