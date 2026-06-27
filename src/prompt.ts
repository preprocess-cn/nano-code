import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginRegistry } from './plugin.js';
import { ChatMessage } from './llm.js';
import { SystemPromptConfig } from './config.js';
import { ToolResponse } from './contract.js';
import { STORE_KEY_MODE } from './plugins/task-plan/types.js';

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
  let finalPrompt = registry.execSystemPrompt(parts.join('\n\n'));

  // ④ Plan Mode 指令注入
  const mode = registry.store.get<string>(STORE_KEY_MODE);
  if (mode === 'plan') {
    finalPrompt += `\n\n## Plan Mode Active

You are currently in PLAN MODE. You MUST NOT make any edits to files (with the exception of the plan file), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system.

### Plan File
Your plan must be written to \`.nano-code/plan.md\` using the file_write tool. Build your plan incrementally — this is the ONLY file you are allowed to edit.

### Workflow

**Phase 1: Initial Understanding**
- Thoroughly explore the codebase to understand existing patterns, relevant files, and architectural approaches.
- Search for existing functions, utilities, and patterns that can be reused.
- Ask the user questions if you need to clarify requirements.

**Phase 2: Design**
- Design a concrete implementation strategy based on your exploration.
- Consider multiple approaches and their trade-offs.
- Write your plan to \`.nano-code/plan.md\`.

**Phase 3: Review & Exit**
- Review your plan against the user's original request.
- Use \`exit_plan_mode\` to present your plan for approval.
- Once approved, you can start implementing.`;
  }

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
