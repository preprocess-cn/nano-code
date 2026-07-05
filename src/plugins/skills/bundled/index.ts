/**
 * 内置 TypeScript 技能系统
 *
 * 对齐 Claude Code 的 `registerBundledSkill` + `BundledSkillDefinition` 模式。
 * 每个技能实现 `BundledSkillDef` 接口，通过 `registerBundledSkill()` 注册到全局 registry。
 * 启动时通过 `registerAllDefaultBundledSkills()` 批量注册全部内置技能。
 *
 * 关键字段：
 * - disableModelInvocation: true → 不在 system prompt 列出，LLM 无法自然调用
 * - userInvocable: false → 从斜杠命令 UI 隐藏
 * - whenToUse: 追加到描述后，帮助 LLM 判断调用时机
 */
import type { PluginRegistry } from '#src/core/plugin.js';

export interface BundledSkillContext {
  cwd: string;
  registry?: PluginRegistry;
  /** 当前使用的模型名称（如 "gpt-4o"），用于 commit 归属签名 */
  modelName?: string;
}

export interface BundledSkillDef {
  name: string;
  description: string;
  aliases?: string[];
  /** 追加到 description 后，格式 "description - whenToUse"，帮助 LLM 判断调用时机 */
  whenToUse?: string;
  argumentHint?: string;
  /** inline: 消息注入主循环（默认）; fork: 子 agent 独立执行 */
  context?: 'inline' | 'fork';
  /** true 则不在 system prompt 列出，LLM 无法自然调用。仍可通过 /name 斜杠调用 */
  disableModelInvocation?: boolean;
  /** false 则从斜杠命令 UI 自动补全隐藏 */
  userInvocable?: boolean;
  /** 生成注入给 LLM 的 prompt 文本 */
  getPrompt(args: string, ctx: BundledSkillContext): Promise<string>;
}

// ── Global registry ──

const _registry = new Map<string, BundledSkillDef>();

export function registerBundledSkill(def: BundledSkillDef): void {
  _registry.set(def.name, def);
}

export function unregisterBundledSkill(name: string): boolean {
  return _registry.delete(name);
}

export function getBundledSkills(): BundledSkillDef[] {
  return Array.from(_registry.values());
}

export function findBundledSkill(name: string): BundledSkillDef | undefined {
  const direct = _registry.get(name);
  if (direct) return direct;
  // Fallback: check aliases
  for (const def of _registry.values()) {
    if (def.aliases?.includes(name)) return def;
  }
  return undefined;
}

/**
 * 获取可用于 system prompt 注入的技能列表。
 * 排除 disableModelInvocation=true 的技能（LLM 不应自然调用它们）。
 */
export function getSystemPromptSkills(): BundledSkillDef[] {
  return getBundledSkills().filter(s => !s.disableModelInvocation);
}

/** 清空 registry（用于测试） */
export function clearBundledSkills(): void {
  _registry.clear();
}

// ── Imports from individual skill files ──

import { createSimplifySkill } from '#src/plugins/skills/bundled/simplify.js';
import { createVerifySkill } from '#src/plugins/skills/bundled/verify.js';
import { createLoremIpsumSkill } from '#src/plugins/skills/bundled/lorem-ipsum.js';
import { createDebugSkill } from '#src/plugins/skills/bundled/debug.js';
import { createBatchSkill } from '#src/plugins/skills/bundled/batch.js';
import { createUpdateConfigSkill } from '#src/plugins/skills/bundled/update-config.js';
import { createRememberSkill } from '#src/plugins/skills/bundled/remember.js';
import { createStuckSkill } from '#src/plugins/skills/bundled/stuck.js';
import { createSkillifySkill } from '#src/plugins/skills/bundled/skillify.js';
import { createKeybindingsSkill } from '#src/plugins/skills/bundled/keybindings.js';
import { createReviewSkill } from '#src/plugins/skills/bundled/review.js';
import { createCommitSkill } from '#src/plugins/skills/bundled/commit.js';
import { createCommitPrSkill } from '#src/plugins/skills/bundled/commit-pr.js';
import { createLoopSkill } from '#src/plugins/skills/bundled/loop.js';

export function registerAllDefaultBundledSkills(): void {
  // Phase 2 — Tier 1
  registerBundledSkill(createSimplifySkill());
  registerBundledSkill(createVerifySkill());
  registerBundledSkill(createLoremIpsumSkill());
  // Phase 3 — Tier 2
  registerBundledSkill(createDebugSkill());
  registerBundledSkill(createReviewSkill());
  registerBundledSkill(createCommitSkill());
  registerBundledSkill(createCommitPrSkill());
  registerBundledSkill(createBatchSkill());
  registerBundledSkill(createUpdateConfigSkill());
  registerBundledSkill(createRememberSkill());
  registerBundledSkill(createStuckSkill());
  // Phase 4 — Tier 3
  registerBundledSkill(createSkillifySkill());
  registerBundledSkill(createKeybindingsSkill());
  // Phase 5 — Cron / Loop
  registerBundledSkill(createLoopSkill());
}

/** 格式化技能描述（对齐 Claude Code formatCommandDescription） */
export function formatSkillDescription(skill: BundledSkillDef): string {
  const desc = skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description;
  return `- ${skill.name}: ${desc}`;
}

/** 从技能列表构建 system prompt 段落 */
export function buildSkillsPromptSection(): string {
  const skills = getSystemPromptSkills();
  if (skills.length === 0) return '';

  const lines = skills.map(formatSkillDescription);
  return `\n可用的内置技能（通过 skill 工具调用）：\n${lines.join('\n')}`;
}
