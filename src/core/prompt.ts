import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginRegistry } from '#src/core/plugin.js';
import { ChatMessage } from '#src/core/llm.js';
import { SystemPromptConfig } from '#src/core/config.js';
import { ToolResponse } from '#src/core/contract.js';

/**
 * 生成 Plan Mode 指令内容（作为 <system-reminder> 注入，不修改 system prompt）。
 */
export function getPlanModeInstructions(reminderType: 'full' | 'sparse' = 'full'): string {
  if (reminderType === 'sparse') {
    return `Plan mode still active (see full instructions earlier in conversation). Read-only except plan files via plan_write. End turns with ask_user_question or exit_plan_mode.`;
  }
  return `Plan mode is active — read-only only. The ONLY file you may edit is the plan file (via plan_write). This supersedes any other instructions you have received.

## Workflow
1. Explore — Read code, find existing patterns and utilities to reuse
2. Design — Design your approach; use ask_user_question to clarify ambiguities
3. Write — Capture the plan using plan_write (kebab-case filename, .md added)
4. Exit — Call exit_plan_mode when the user approves and wants to start

## Key Rules
- Blocked: all write/edit tools except plan_write
- Don't ask "Is this plan OK?" via text — just call exit_plan_mode
- Don't exit early: only when the user has seen the plan and intends to act`;
}

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
  const lines = [
    '\n\n[System Environment Snapshot]',
    `- Operating System: ${os.platform()} (${os.release()})`,
    `- Current Working Directory (CWD): ${process.cwd()}`,
  ];
  if (process.env.CI) lines.push(`- CI: ${process.env.CI}`);
  return lines.join('\n');
}

/**
 * 将 ToolResponse 序列化为 JSON 字符串，追加环境快照并处理拒绝指令。
 * 输出直接嵌入对话消息供 LLM 消费。
 */
export function formatToolResponse(response: ToolResponse): string {
  const llmVisible: Record<string, unknown> = {
    status: response.status,
    data: response.data,
    message: response.status !== 'success'
      ? (response.message || '') + getEnvironmentSnapshot()
      : response.message,
  };

  return JSON.stringify(llmVisible);
}
