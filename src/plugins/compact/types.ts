import { ChatMessage } from '#src/core/llm.js';

export interface CompactOptions {
  /** 保留多少组（user→assistant）对话，默认 2 */
  preserveCount?: number;
  /** 预览模式 — 不修改历史，只报告预估节省 */
  dryRun?: boolean;
  /** 模型覆盖（如 gpt-4o-mini 做价格更低的总结） */
  summaryModel?: string;
  /** 自定义总结侧重指令 */
  customInstructions?: string;
}

export interface CompactionResult {
  /** 完整替换 messageHistory 的消息数组 */
  messages: ChatMessage[];
  /** 纯摘要文本（已剥离 <analysis> 标签） */
  summary: string;
  /** 原始消息数 */
  originalMessageCount: number;
  /** 压缩后消息数 */
  compactedMessageCount: number;
  /** 原始预估 token 数 */
  originalTokens: number;
  /** 压缩后预估 token 数 */
  compactedTokens: number;
  /** 节省的 token 数 */
  savedTokens: number;
}
