import { NanoPlugin, PluginRegistry, ToolCall } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';
import { LLMClient } from '../../llm.js';
import { NanoCodeAgent } from '../../agent.js';
import { DisplayManager } from '../../display.js';
import { loadAllSkills, findSkill, listSkillFiles, readSkillFile, getSkillsDir, substituteArgs, SkillDefinition } from './loader.js';

function buildSkillList(): Array<{ name: string; description: string; context: string }> {
  return loadAllSkills()
    .map(s => ({ name: s.name, description: s.description, context: s.context }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 创建技能插件。
 *
 * @param llmClient 可选 - 传人则 fork 模式可用，否则 fork 回退为 inline
 * @param display   可选 - 展示层管理器（子 agent 输出用）
 */
export function createSkillsPlugin(llmClient?: LLMClient, display?: DisplayManager): NanoPlugin {
  return {
    name: 'skills',
    description: '技能系统 — 从 SKILL.md 加载并执行技能',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'skills_list',
            description: '列出所有可用技能及描述。使用 skill(<name>) 执行某个技能。',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
            sideEffect: false,
          },
        },
        {
          type: 'function',
          function: {
            name: 'skill_view',
            description: '查看某个技能的完整内容或附属文件（引用、模板等）。调用后返回 SKILL.md 的完整内容。如果需要查看技能目录下的特定文件，传入 file_path 参数。',
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: '技能名称，使用 skills_list 查看可用技能',
                },
                file_path: {
                  type: 'string',
                  description: '可选：技能目录下的文件路径，如 "references/api.md"',
                },
              },
              required: ['name'],
            },
            sideEffect: false,
          },
        },
        {
          type: 'function',
          function: {
            name: 'skill',
            description: '执行一个技能。技能会按照 SKILL.md 中的指令指导完成特定任务。技能可能有多步操作。',
            parameters: {
              type: 'object',
              properties: {
                skill: {
                  type: 'string',
                  description: '技能名称，使用 skills_list 查看可用技能',
                },
                args: {
                  type: 'string',
                  description: '可选的参数，传递给技能的内容替换 {args} 占位符',
                },
              },
              required: ['skill'],
            },
            sideEffect: true,
          },
        },
      ];
    },

    async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
      switch (name) {
        case 'skills_list':
          return handleSkillsList();
        case 'skill_view':
          return handleSkillView(args);
        case 'skill':
          return handleSkillExecute(args, llmClient, display);
        default:
          return { status: 'error', message: `Unknown tool: ${name}` };
      }
    },
  };
}

function handleSkillsList(): ToolResponse {
  const skills = buildSkillList();
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

function handleSkillView(args: any): ToolResponse {
  const name = args?.name?.trim();
  if (!name) return { status: 'error', message: '参数 name 不能为空' };

  const skill = findSkill(name);
  if (!skill) {
    const available = buildSkillList().map(s => s.name);
    return { status: 'error', message: `技能 "${name}" 未找到。可用技能: ${available.join(', ') || '(无)'}` };
  }

  // 请求附属文件
  if (args?.file_path) {
    const content = readSkillFile(skill.dir, args.file_path);
    if (content === null) {
      const files = listSkillFiles(skill.dir);
      return { status: 'error', message: `文件 "${args.file_path}" 未找到。可用文件: ${files.join(', ') || '(无)'}` };
    }
    return { status: 'success', data: JSON.stringify({ name: skill.name, file: args.file_path, content }) };
  }

  // 返回技能完整内容 + 附属文件列表
  const linkedFiles = listSkillFiles(skill.dir);
  return {
    status: 'success',
    data: JSON.stringify({
      name: skill.name,
      description: skill.description,
      context: skill.context,
      content: skill.body,
      linkedFiles: linkedFiles.length > 0 ? linkedFiles : undefined,
      hint: linkedFiles.length > 0
        ? `附属文件可通过 skill_view({ name: "${skill.name}", file_path: "<路径>" }) 查看`
        : undefined,
    }),
  };
}

async function handleSkillExecute(
  args: any,
  llmClient?: LLMClient,
  display?: DisplayManager,
): Promise<ToolResponse> {
  const skillName = args?.skill?.trim();
  if (!skillName) return { status: 'error', message: '参数 skill 不能为空' };

  const skill = findSkill(skillName);
  if (!skill) {
    const available = buildSkillList().map(s => s.name);
    return { status: 'error', message: `技能 "${skillName}" 未找到。可用技能: ${available.join(', ') || '(无)'}` };
  }

  const argsStr = typeof args?.args === 'string' ? args.args : '';
  const mode = skill.context;

  if (mode === 'fork') {
    return executeForkedSkill(skill, argsStr, llmClient, display);
  }

  // Inline 模式：内容作为 newMessages 注入
  const content = substituteArgs(skill.body, argsStr);
  const baseDirNote = skill.dir ? `技能目录: ${skill.dir}\n解析此技能中的相对路径时，请基于该目录计算。\n\n` : '';
  return {
    status: 'success',
    message: `正在展开技能: ${skillName}`,
    newMessages: [{ role: 'user', content: baseDirNote + content }],
  };
}

async function executeForkedSkill(
  skill: SkillDefinition,
  argsStr: string,
  llmClient?: LLMClient,
  display?: DisplayManager,
): Promise<ToolResponse> {
  if (!llmClient) {
    // 无 LLMClient 时回退为 inline
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

  // 创建子 agent 隔离执行
  const subRegistry = new PluginRegistry();
  subRegistry.setAgentName(skill.name);
  subRegistry.setDefaultContext({ skipPermission: true, defaultTimeout: 120000 });

  // 子 agent 只注册基础工具
  const { registerBuiltinPlugin } = await import('../../plugin.js');
  await registerBuiltinPlugin(subRegistry, 'fs');
  await registerBuiltinPlugin(subRegistry, 'command');
  await registerBuiltinPlugin(subRegistry, 'memory');
  await registerBuiltinPlugin(subRegistry, 'token-budget');

  const subAgent = new NanoCodeAgent(
    subRegistry,
    llmClient,
    `技能: ${skill.name}`,
    undefined,
    skill.name,
    display,
  );

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
