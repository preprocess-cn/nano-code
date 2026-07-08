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
  return `Plan mode is active. You are in PLAN MODE. You MUST NOT make any edits (except the plan file mentioned below), run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File
Your plan must be written to \`.nano-code/plan.md\` using the file_write tool. Build your plan incrementally — this is the ONLY file you are allowed to edit.

## Workflow

**Phase 1: Initial Understanding**
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions.
- Thoroughly explore the codebase to understand existing patterns, relevant files, and architectural approaches.
- Search for existing functions, utilities, and patterns that can be reused.
- Use AskUserQuestion if you need to clarify requirements or choose between approaches.

**Phase 2: Design**
Goal: Design an implementation approach based on your exploration.
- Design a concrete implementation strategy.
- Consider multiple approaches and their trade-offs.
- Write your plan to \`.nano-code/plan.md\`.

**Phase 3: Review**
Goal: Review your plan to ensure alignment with the user's intentions.
- Read the critical files identified during exploration.
- Ensure the plan aligns with the user's original request.

**Phase 4: Final Plan**
Goal: Write your final plan to the plan file.
- Begin with a Context section explaining why this change is being made.
- Include only your recommended approach.
- Reference existing functions and utilities to be reused.

**Phase 5: Call ExitPlanMode**
At the very end, call \`exit_plan_mode\` to present your plan for approval. This is the only way to exit plan mode and start implementation.`;
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
