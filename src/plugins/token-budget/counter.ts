import { ChatMessage } from '../../llm.js';

// ── Tiktoken tokenizer (lazy singleton) ──

let _tokenizer: { encode: (s: string) => { length: number }; free: () => void } | null = null;
let _tokenizerError: unknown = null;

async function getTokenizer(): Promise<{ encode: (s: string) => { length: number }; free: () => void } | null> {
  if (_tokenizer) return _tokenizer;
  if (_tokenizerError) return null; // previously failed, skip retry
  try {
    const { get_encoding } = await import('tiktoken');
    _tokenizer = get_encoding('cl100k_base');
    return _tokenizer;
  } catch (err) {
    _tokenizerError = err;
    return null;
  }
}

/** 延迟初始化 tokenizer（可在启动时预热） */
export async function initTokenizer(): Promise<void> {
  await getTokenizer();
}

/** 精确 token 计数（tiktoken cl100k_base），不可用时回退 text/3 估算 */
export function countTokens(text: string): number {
  if (_tokenizer) {
    return _tokenizer.encode(text).length;
  }
  // Fallback estimation when tiktoken is unavailable
  return Math.ceil(text.length / 3);
}

/** 遍历消息数组计算 token 总数，每消息 +4 overhead */
export function countMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += countTokens(m.content || '');
    total += 4; // role marker overhead
  }
  return total;
}
