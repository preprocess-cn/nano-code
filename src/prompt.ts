import * as fs from 'fs';
import * as path from 'path';
import { PluginRegistry } from './plugin.js';
import { ChatMessage } from './llm.js';

const CORE_AGENT_INSTRUCTIONS = [
  "你是一个名为 nano-code 的终端 AI 编程助手。你可以通过调用工具来查看目录、读取文件和写入修改文件。",
  "【核心安全约束】如果人类用户拒绝了你的工具执行权限（返回状态为 rejected_by_user），这是最高级别的物理约束。",
  "你必须立刻停止该方向的尝试，在当前轮次中严禁再次生成任何工具调用（tool_calls），绝对不要换个参数或换个工具重试。",
  "请转为纯文本模式，向用户诚恳解释该操作的必要性，并主动提供其他不依赖该工具的非侵入式替代方案（例如提供手动指令或打印代码由用户自行复制）。",
  "请保持回答简洁专业。"
].join('\n');

/**
 * Build the system prompt for the LLM.
 *
 * ① Core Agent built-in instructions
 * ② Project-level instruction file (auto-discovered: AGENT.md > CLAUDE.md > AGENT.txt > CLAUDE.txt)
 * ③ Plugin contributions (via onSystemPrompt hook)
 */
export function buildSystemPrompt(registry: PluginRegistry): ChatMessage {
  const parts: string[] = [];

  // ① Core Agent built-in instructions
  parts.push(CORE_AGENT_INSTRUCTIONS);

  // ② Project-level instruction file
  const userFile = findProjectInstructionFile();
  if (userFile) parts.push(userFile);

  // ③ Plugin contributions
  const finalPrompt = registry.execSystemPrompt(parts.join('\n\n'));

  return {
    role: 'system',
    content: finalPrompt,
  };
}

function findProjectInstructionFile(): string | null {
  const cwd = process.cwd();
  for (const name of ['AGENT.md', 'CLAUDE.md', 'AGENT.txt', 'CLAUDE.txt']) {
    try {
      const content = fs.readFileSync(path.join(cwd, name), 'utf-8');
      if (content.trim()) return content;
    } catch {
      /* file doesn't exist, try next */
    }
  }
  return null;
}
