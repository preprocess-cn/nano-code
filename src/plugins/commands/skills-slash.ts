import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { CommandInterceptResult } from '#src/core/contract.js';
import { LLMClient } from '#src/core/llm.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { DisplayManager } from '#src/display.js';
import { findSkill, substituteArgs } from '#src/plugins/skills/loader.js';
import { findBundledSkill } from '#src/plugins/skills/bundled/index.js';

let _registry: PluginRegistry | undefined;

export function createSkillsSlashPlugin(llmClient?: LLMClient, display?: DisplayManager): NanoPlugin {
  return {
    name: 'skills-slash',
    description: '斜杠技能调用 — /<技能名> [参数]',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'skills-slash 插件不提供工具调用' }; },

    onInit(registry: PluginRegistry): Promise<void> {
      _registry = registry;
      return Promise.resolve();
    },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      if (!input.startsWith('/')) return null;

      const name = input.slice(1).trim();
      const spaceIdx = name.indexOf(' ');
      const skillName = spaceIdx === -1 ? name : name.slice(0, spaceIdx);
      const argsStr = spaceIdx === -1 ? '' : name.slice(spaceIdx + 1).trim();

      // Try file-based skill first
      const fsSkill = findSkill(skillName);
      if (fsSkill) {
        return handleFsSkill(fsSkill, skillName, argsStr, llmClient, display);
      }

      // Fallback to bundled skill — 优先 execute（绕过 LLM），fallback getPrompt
      const bundledSkill = findBundledSkill(skillName);
      if (bundledSkill) {
        // 尝试 execute 直接执行操作（如 ! 前缀的 shell 任务）
        if (bundledSkill.execute) {
          const result = await bundledSkill.execute(argsStr, { cwd: process.cwd(), registry: _registry });
          if (result) return result;
        }
        // getPrompt 生成指令文本供 LLM 解析
        const content = await bundledSkill.getPrompt(argsStr, { cwd: process.cwd() });
        return {
          handled: true,
          message: `正在展开技能: ${skillName}`,
          injectMessages: [{ role: 'user', content }],
        };
      }

      return null;
    },
  };
}

/** Handle a file-based skill (inline or fork) */
async function handleFsSkill(
  skill: import('#src/plugins/skills/loader.js').SkillDefinition,
  skillName: string,
  argsStr: string,
  llmClient?: LLMClient,
  display?: DisplayManager,
): Promise<CommandInterceptResult | null> {
  if (skill.context === 'fork') {
    if (!llmClient) {
      // Fallback to inline
      const content = substituteArgs(skill.body, argsStr);
      const baseDirNote = skill.dir ? `技能目录: ${skill.dir}\n\n` : '';
      return {
        handled: true,
        injectMessages: [{ role: 'user', content: baseDirNote + content }],
      };
    }

    const content = substituteArgs(skill.body, argsStr);
    const baseDirNote = `技能目录: ${skill.dir}\n\n`;
    const fullPrompt = baseDirNote + content;

    const subRegistry = new PluginRegistry();
    subRegistry.setAgentName(skill.name);
    subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

    const { registerBuiltinPlugin } = await import('#src/core/plugin.js');
    await registerBuiltinPlugin(subRegistry, 'fs');
    await registerBuiltinPlugin(subRegistry, 'command');
    await registerBuiltinPlugin(subRegistry, 'memory');
    await registerBuiltinPlugin(subRegistry, 'token-budget');
    await registerBuiltinPlugin(subRegistry, 'file-search');

    const subAgent = new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: `技能: ${skill.name}`, name: skill.name, display });

    try {
      const result = await subAgent.runTask(fullPrompt);
      display?.onStatus({ message: `技能 "${skillName}" 执行完毕`, agentName: 'main', level: 'success' });
      const resultText = result || '(技能执行完毕)';
      return {
        handled: true,
        replaceInput: `[技能: ${skillName}]\n${resultText}`,
      };
    } catch (err: any) {
      display?.onError({ message: `技能执行失败: ${err.message}`, agentName: 'main' });
      return { handled: true, skipAgent: true };
    }
  }

  // Inline mode
  const content = substituteArgs(skill.body, argsStr);
  const baseDirNote = skill.dir ? `技能目录: ${skill.dir}\n\n` : '';
  return {
    handled: true,
    message: `正在展开技能: ${skillName}`,
    injectMessages: [{ role: 'user', content: baseDirNote + content }],
  };
}
