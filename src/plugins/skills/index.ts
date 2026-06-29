import { NanoPlugin, PluginRegistry } from '../../core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../core/contract.js';
import { LLMClient } from '../../core/llm.js';
import { NanoCodeAgent } from '../../core/agent.js';
import { DisplayManager } from '../../display.js';
import { loadAllSkills, findSkill, listSkillFiles, readSkillFile, getSkillsDir, substituteArgs, SkillDefinition } from './loader.js';
import {
  findBundledSkill,
  getBundledSkills,
  buildSkillsPromptSection,
} from './bundled/index.js';

export interface SkillsPluginOptions {
  disabled?: string[];
  disableSkillTool?: boolean;
}

/**
 * 构建内置 + 文件系统统一的技能列表。
 * 排除用户禁用的技能名。
 */
function buildSkillList(disabled?: string[]): Array<{ name: string; description: string; context: string }> {
  const bundled = getBundledSkills()
    .filter(s => !s.disableModelInvocation)
    .filter(s => !disabled?.includes(s.name))
    .map(s => ({ name: s.name, description: s.description, context: s.context || 'inline' }));

  const fsSkills = loadAllSkills()
    .filter(s => !disabled?.includes(s.name))
    .map(s => ({ name: s.name, description: s.description, context: s.context }));
  return [...bundled, ...fsSkills].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 创建技能插件。
 *
 * @param llmClient 可选 - 传人则 fork 模式可用，否则 fork 回退为 inline
 * @param display   可选 - 展示层管理器（子 agent 输出用）
 * @param options   可选 - 技能配置选项（禁用列表）
 */
export function createSkillsPlugin(
  llmClient?: LLMClient,
  display?: DisplayManager,
  options?: SkillsPluginOptions,
): NanoPlugin {
  const disabled = options?.disabled ?? [];

  return {
    name: 'skills',
    description: '技能系统 — 内置 TypeScript 技能 + SKILL.md 技能',

    getTools(): ToolDefinition[] {
      const tools: ToolDefinition[] = [];

      // skill / skills_list / skill_view 可整体禁用
      if (!options?.disableSkillTool) {
        tools.push({
          type: 'function',
          function: {
            name: 'skills_list',
            description: '列出所有可用技能及描述。使用 skill(<name>) 执行某个技能。',
            parameters: { type: 'object', properties: {}, required: [] },
            sideEffect: false,
          },
        });

        tools.push({
          type: 'function',
          function: {
            name: 'skill_view',
            description: '查看某个技能的完整内容或附属文件（引用、模板等）。调用后返回 SKILL.md 的完整内容。如果需要查看技能目录下的特定文件，传入 file_path 参数。',
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '技能名称，使用 skills_list 查看可用技能' },
                file_path: { type: 'string', description: '可选：技能目录下的文件路径，如 "references/api.md"' },
              },
              required: ['name'],
            },
            sideEffect: false,
          },
        });

        tools.push({
          type: 'function',
          function: {
            name: 'skill',
            description: '执行一个技能。技能会按照指令指导完成特定任务。技能可能有多步操作。',
            parameters: {
              type: 'object',
              properties: {
                skill: { type: 'string', description: '技能名称，使用 skills_list 查看可用技能' },
                args: { type: 'string', description: '可选的参数，传递给技能的内容替换 {args} 占位符' },
              },
              required: ['skill'],
            },
            sideEffect: true,
          },
        });
      }

      // run_agent — 供 simplify/batch 等技能使用子 agent
      tools.push({
        type: 'function',
        function: {
          name: 'run_agent',
          description: '启动一个独立的子 agent 执行指定任务并返回结果。用于并行分析、代码审查等工作。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '子 agent 的任务描述' },
              role: { type: 'string', description: '子 agent 的角色描述', default: '助手' },
            },
            required: ['query'],
          },
          sideEffect: true,
        },
      });

      return tools;
    },

    async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      switch (name) {
        case 'skills_list':
          return handleSkillsList(disabled);
        case 'skill_view':
          return handleSkillView(args, disabled);
        case 'skill':
          return handleSkillExecute(args, llmClient, display, disabled);
        case 'run_agent':
          return handleRunAgent(args, llmClient, display);
        default:
          return { status: 'error', message: `Unknown tool: ${name}` };
      }
    },

    onSystemPrompt(prompt: string): string {
      const section = buildSkillsPromptSection();
      if (!section) return prompt;
      return prompt + section;
    },

  };
}

// ── Handler implementations ──

function handleSkillsList(disabled?: string[]): ToolResponse {
  const skills = buildSkillList(disabled);
  if (skills.length === 0) {
    return {
      status: 'success',
      data: JSON.stringify({
        skills: [],
        message: `无可用技能。技能目录: ${getSkillsDir()}。在此目录下创建 <name>/SKILL.md 来添加技能。`,
      }),
    };
  }

  return {
    status: 'success',
    data: JSON.stringify({
      skills,
      hint: '使用 skill(<name>) 执行技能，使用 skill_view(<name>) 查看完整内容',
    }),
  };
}

function handleSkillView(args: any, disabled?: string[]): ToolResponse {
  const name = args?.name?.trim();
  if (!name) return { status: 'error', message: '参数 name 不能为空' };

  // 先查文件系统技能
  const fsSkill = findSkill(name);
  if (fsSkill) {
    if (args?.file_path) {
      const content = readSkillFile(fsSkill.dir, args.file_path);
      if (content === null) {
        const files = listSkillFiles(fsSkill.dir);
        return { status: 'error', message: `文件 "${args.file_path}" 未找到。可用文件: ${files.join(', ') || '(无)'}` };
      }
      return { status: 'success', data: JSON.stringify({ name: fsSkill.name, file: args.file_path, content }) };
    }

    const linkedFiles = listSkillFiles(fsSkill.dir);
    return {
      status: 'success',
      data: JSON.stringify({
        name: fsSkill.name,
        description: fsSkill.description,
        context: fsSkill.context,
        content: fsSkill.body,
        linkedFiles: linkedFiles.length > 0 ? linkedFiles : undefined,
      }),
    };
  }

  // 再查内置技能
  const bundledSkill = findBundledSkill(name);
  if (bundledSkill) {
    if (disabled?.includes(name)) {
      return { status: 'error', message: `技能 "${name}" 已被禁用。` };
    }
    const desc = bundledSkill.whenToUse
      ? `${bundledSkill.description} - ${bundledSkill.whenToUse}`
      : bundledSkill.description;
    return {
      status: 'success',
      data: JSON.stringify({
        name: bundledSkill.name,
        description: desc,
        context: bundledSkill.context || 'inline',
        type: 'bundled',
        content: '(内置 TypeScript 技能，无法查看源码)',
      }),
    };
  }

  const available = buildSkillList(disabled).map(s => s.name);
  return { status: 'error', message: `技能 "${name}" 未找到。可用技能: ${available.join(', ') || '(无)'}` };
}

async function handleSkillExecute(
  args: any,
  llmClient?: LLMClient,
  display?: DisplayManager,
  disabled?: string[],
): Promise<ToolResponse> {
  const skillName = args?.skill?.trim();
  if (!skillName) return { status: 'error', message: '参数 skill 不能为空' };

  if (disabled?.includes(skillName)) {
    return { status: 'error', message: `技能 "${skillName}" 已被禁用。如需启用，请修改配置文件后重启 nano-code。` };
  }

  // 先查文件系统技能
  const fsSkill = findSkill(skillName);
  if (fsSkill) {
    const argsStr = typeof args?.args === 'string' ? args.args : '';
    const mode = fsSkill.context;
    if (mode === 'fork') {
      return executeForkedSkill(fsSkill, argsStr, llmClient, display);
    }
    const content = substituteArgs(fsSkill.body, argsStr);
    const baseDirNote = fsSkill.dir ? `技能目录: ${fsSkill.dir}\n解析此技能中的相对路径时，请基于该目录计算。\n\n` : '';
    return {
      status: 'success',
      message: `正在展开技能: ${skillName}`,
      newMessages: [{ role: 'user', content: baseDirNote + content }],
    };
  }

  // 再查内置技能
  const bundledSkill = findBundledSkill(skillName);
  if (bundledSkill) {
    const argsStr = typeof args?.args === 'string' ? args.args : '';
    const prompt = await bundledSkill.getPrompt(argsStr, {
      cwd: process.cwd(),
    });
    return {
      status: 'success',
      message: `正在展开内置技能: ${skillName}`,
      newMessages: [{ role: 'user', content: prompt }],
    };
  }

  const available = buildSkillList(disabled).map(s => s.name);
  return { status: 'error', message: `技能 "${skillName}" 未找到。可用技能: ${available.join(', ') || '(无)'}` };
}

async function executeForkedSkill(
  skill: SkillDefinition,
  argsStr: string,
  llmClient?: LLMClient,
  display?: DisplayManager,
): Promise<ToolResponse> {
  if (!llmClient) {
    const content = substituteArgs(skill.body, argsStr);
    return {
      status: 'success',
      message: `正在展开技能: ${skill.name}（fork 不可用，回退为 inline）`,
      newMessages: [{ role: 'user', content }],
    };
  }

  const content = substituteArgs(skill.body, argsStr);
  const baseDirNote = `技能目录: ${skill.dir}\n\n`;
  const fullPrompt = baseDirNote + content;

  const subRegistry = new PluginRegistry();
  subRegistry.setAgentName(skill.name);
  subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

  const { registerBuiltinPlugin } = await import('../../core/plugin.js');
  await registerBuiltinPlugin(subRegistry, 'fs');
  await registerBuiltinPlugin(subRegistry, 'command');
  await registerBuiltinPlugin(subRegistry, 'memory');
  await registerBuiltinPlugin(subRegistry, 'token-budget');
  await registerBuiltinPlugin(subRegistry, 'search');

  const subAgent = new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: `技能: ${skill.name}`, name: skill.name, display });

  try {
    const result = await subAgent.runTask(fullPrompt);
    return {
      status: 'success',
      data: result || '(技能执行完毕)',
    };
  } catch (err: any) {
    return { status: 'error', message: `技能执行失败: ${err.message}` };
  }
}

async function handleRunAgent(
  args: any,
  llmClient?: LLMClient,
  display?: DisplayManager,
): Promise<ToolResponse> {
  const query = args?.query?.trim();
  if (!query) return { status: 'error', message: '参数 query 不能为空' };
  if (!llmClient) return { status: 'error', message: '子 agent 不可用：无 LLM 客户端' };

  const role = args?.role?.trim() || '助手';

  const subRegistry = new PluginRegistry();
  subRegistry.setAgentName('run_agent');
  subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

  const { registerBuiltinPlugin } = await import('../../core/plugin.js');
  await registerBuiltinPlugin(subRegistry, 'fs');
  await registerBuiltinPlugin(subRegistry, 'command');
  await registerBuiltinPlugin(subRegistry, 'memory');
  await registerBuiltinPlugin(subRegistry, 'token-budget');
  await registerBuiltinPlugin(subRegistry, 'search');

  const subAgent = new NanoCodeAgent({ registry: subRegistry, llmClient, agentRole: role, name: 'run_agent', display });

  try {
    const result = await subAgent.runTask(query);
    return {
      status: 'success',
      data: result || '(子 agent 未返回内容)',
    };
  } catch (err: any) {
    return { status: 'error', message: `子 agent 执行失败: ${err.message}` };
  }
}
