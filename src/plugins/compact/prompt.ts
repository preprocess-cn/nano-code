/**
 * 压缩总结 prompt 模板
 *
 * 移植自 Claude Code 的 src/services/compact/prompt.ts。
 * 核心模式：禁止调用工具 → 输出 <analysis>（内部草稿）+ <summary>（对外摘要）。
 */

export const COMPACT_SYSTEM_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, code snippets, function signatures, file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request.

Provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response.

REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected.`;

/** 单条消息最大字符数（过长会截断以保护总结调用的 context） */
const MAX_MESSAGE_CHARS = 8000;

/**
 * 将消息历史组装为用户 prompt，供总结 LLM 使用。
 * 为防总结调用自身超出 context，每条消息截断到 MAX_MESSAGE_CHARS。
 */
export function buildCompactUserPrompt(messages: Array<{ role: string; content: string | null }>): string {
  const lines: string[] = ['Please analyze and summarize this conversation:', ''];
  for (const m of messages) {
    const roleLabel =
      m.role === 'user' ? 'User' :
      m.role === 'assistant' ? 'AI Assistant' :
      m.role === 'tool' ? 'Tool Result' :
      m.role === 'system' ? 'System' : m.role;
    const content = (m.content || '').slice(0, MAX_MESSAGE_CHARS);
    if (content) {
      lines.push(`<${roleLabel}>`);
      lines.push(content);
      lines.push(`</${roleLabel}>`);
    }
  }
  lines.push('', 'Provide your <analysis> and <summary>.');
  return lines.join('\n');
}

/**
 * 从 LLM 返回的原始文本中提取 <summary> 内容。
 * 优先匹配 <summary> 标签；无标签时回退为去 <analysis> 后的全部文本。
 */
export function extractSummary(raw: string): string {
  const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }
  // Fallback: strip <analysis> entirely, return rest trimmed
  return raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim();
}

/**
 * 格式化摘要为用户消息，注入到压缩后的对话历史中。
 * 让 LLM 知道此前对话已被压缩。
 */
export function formatCompactSummaryMessage(summary: string): string {
  return [
    '[Previous conversation has been summarized below]',
    '',
    summary,
    '',
    'Please continue based on this summary and the more recent messages below.',
  ].join('\n');
}
