import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { CommandInterceptResult } from '#src/core/contract.js';
import { LLMClient } from '#src/core/llm.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { DisplayManager } from '#src/display.js';
import { findSkill, substituteArgs } from '#src/plugins/skills/loader.js';

export function createSkillsSlashPlugin(llmClient?: LLMClient, display?: DisplayManager): NanoPlugin {
  return {
    name: 'skills-slash',
    description: '斜杠技能调用 — /<技能名> [参数]',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'skills-slash 插件不提供工具调用' }; },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      if (!input.startsWith('/')) return null;

      const name = input.slice(1).trim();
      const spaceIdx = name.indexOf(' ');
      const skillName = spaceIdx === -1 ? name : name.slice(0, spaceIdx);
      const argsStr = spaceIdx === -1 ? '' : name.slice(spaceIdx + 1).trim();

      const skill = findSkill(skillName);
      if (!skill) return null;

      if (skill.context === 'fork') {
        if (!llmClient) {
          // 回退 inline
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
        await registerBuiltinPlugin(subRegistry, 'search');

        const subAgent = new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: `技能: ${skill.name}`, name: skill.name, display });

        try {
          const result = await subAgent.runTask(fullPrompt);
          display?.onStatus({ message: `技能 "${skillName}" 执行完毕`, agentName: 'main', level: 'success' });
          // Fork 结果替换原始输入，反馈给主 LLM
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

      // Inline 模式
      const content = substituteArgs(skill.body, argsStr);
      const baseDirNote = skill.dir ? `技能目录: ${skill.dir}\n\n` : '';
      return {
        handled: true,
        message: `正在展开技能: ${skillName}`,
        injectMessages: [{ role: 'user', content: baseDirNote + content }],
      };
    },
  };
}
