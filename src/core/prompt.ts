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
export function getPlanModeInstructions(): string {
  return `Plan mode is active. You are in PLAN MODE. You MUST NOT make any edits (except writing plan files), run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan Files
Use the \`plan_write\` tool to write plans to ~/.nano-code/plan/. Choose a descriptive kebab-case filename (e.g. "refactor-utils"). The .md extension is added automatically. You can write multiple versions — use version suffixes like "refactor-utils-v2".

Since plan files are outside the project directory, no permission is needed. This is the ONLY way to write files in plan mode.

## Workflow

**Phase 1: Initial Understanding**
Goal: Gain a comprehensive understanding of the user's request.
- Thoroughly explore the codebase.
- Search for existing patterns and utilities.
- Use AskUserQuestion to clarify requirements.

**Phase 2: Design**
Goal: Design an implementation approach.
- Design a concrete strategy.
- Write your plan using \`plan_write\`.

**Phase 3: Review & Iterate (stay in plan mode)**
Goal: Review and refine the plan. **Stay in plan mode. Do NOT call exit_plan_mode yet.**
- Summarize the plan for the user.
- Wait for the user's response.
- If the user asks for changes — update the plan with \`plan_write\` again.
- Iterate as many times as needed.

**Phase 4: Execute (exit plan mode)**
Only call \`exit_plan_mode\` when the user explicitly says "execute", "开始执行",
or similar. This exits plan mode — the plan content is returned so you can
start implementing immediately.`;
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
