import * as fs from 'fs';
import * as path from 'path';
import { PluginRegistry } from './plugin.js';
import { ChatMessage } from './llm.js';
import { SystemPromptConfig } from './config.js';

/**
 * 组装系统提示词。
 *
 * ① 角色模板（带变量替换 {role} {tool_list}）
 * ② 项目级指令文件
 * ③ 插件钩子（onSystemPrompt）
 *
 * 所有提示词原文来自 config.yaml 的 system_prompt 段，此处只做拼接。
 */
export function buildSystemPrompt(
  registry: PluginRegistry,
  promptConfig?: SystemPromptConfig,
  agentRole?: string,
): ChatMessage {
  const parts: string[] = [];
  const tools = registry.getAllSchemas();
  const role = agentRole || (tools.length > 0 ? '终端 AI 编程助手' : 'AI 对话助手');

  // ① 角色模板 + 变量替换
  if (tools.length > 0) {
    const tmpl = promptConfig?.withTools;
    if (tmpl) {
      const toolList = tools.map(t => t.function.name).join('、');
      parts.push(tmpl.replace(/\{role\}/g, role).replace(/\{tool_list\}/g, toolList));
    }
  } else {
    const tmpl = promptConfig?.noTools;
    if (tmpl) {
      parts.push(tmpl.replace(/\{role\}/g, role));
    }
  }

  // ② 项目级指令文件
  const files = promptConfig?.projectFiles ?? ['AGENT.md', 'CLAUDE.md', 'AGENT.txt', 'CLAUDE.txt'];
  for (const name of files) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), name), 'utf-8');
      if (content.trim()) { parts.push(content.trim()); break; }
    } catch { /* 文件不存在，尝试下一个 */ }
  }

  // ③ 插件贡献
  const finalPrompt = registry.execSystemPrompt(parts.join('\n\n'));

  return { role: 'system', content: finalPrompt };
}
