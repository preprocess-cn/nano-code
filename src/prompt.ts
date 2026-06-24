import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginRegistry } from './plugin.js';
import { ChatMessage } from './llm.js';
import { SystemPromptConfig } from './config.js';
import { ToolResponse } from './contract.js';

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

  // ② 项目级指令文件（如 AGENT.md，用于向 LLM 传递项目特定指令）
  // CLAUDE.md / CLAUDE.txt 是给 Claude Code 工具的，不应发给 LLM。
  const files = promptConfig?.projectFiles ?? ['AGENT.md', 'AGENT.txt'];
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

function getEnvironmentSnapshot(): string {
  return [
    '\n\n[System Environment Snapshot]',
    `- Operating System: ${os.platform()} (${os.release()})`,
    `- Current Working Directory (CWD): ${process.cwd()}`,
    `- Shell Env: CI=true`,
  ].join('\n');
}

/**
 * 将 ToolResponse 序列化为 JSON 字符串，追加环境快照并处理拒绝指令。
 * 输出直接嵌入对话消息供 LLM 消费。
 */
export function formatToolResponse(response: ToolResponse): string {
  if (response.status === 'rejected_by_user') {
    return JSON.stringify({
      status: 'rejected_by_user',
      message: [
        "CRITICAL ERROR: The human user has EXPLICITLY DENIED permission for this action.",
        "DO NOT attempt to retry this tool or any alternative tool execution in this turn.",
        "DO NOT generate any more tool calls.",
        "Your current operation pipeline must be HALTED immediately.",
        "Next Action Required:",
        "1. Politely acknowledge that the user cancelled the operation.",
        "2. Explain to the user why this specific operation was necessary for their request.",
        "3. Propose alternative, non-invasive or safer solutions (e.g., printing code to screen for manual copy, manual command advice) and wait for the user's feedback."
      ].join(' ') + getEnvironmentSnapshot()
    });
  }

  const enriched = { ...response };
  if (enriched.status !== 'success') {
    enriched.message = (enriched.message || '') + getEnvironmentSnapshot();
  }

  return JSON.stringify(enriched);
}
