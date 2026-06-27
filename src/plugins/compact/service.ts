import { ChatMessage, LLMClient } from '../../llm.js';
import { NanoCodeAgent } from '../../agent.js';
import { PluginRegistry } from '../../plugin.js';
import { DisplayManager } from '../../display.js';
import { countMessagesTokens } from '../token-budget/counter.js';
import { CompactOptions, CompactionResult } from './types.js';
import {
  COMPACT_SYSTEM_PROMPT,
  buildCompactUserPrompt,
  extractSummary,
  formatCompactSummaryMessage,
} from './prompt.js';

/**
 * CompactService — 对话历史压缩核心编排。
 *
 * 职责：
 * 1. 分割历史为"可总结"和"可保留"两部分
 * 2. 调用 LLM 生成摘要（无工具调用）
 * 3. 组装新消息数组（边界标记 + 摘要 + 保留消息 + 文件缓存）
 * 4. 返回 CompactionResult（不直接修改 agent）
 *
 * 设计原则：
 * - Service 不做 mutation，由调用方执行 agent.loadHistory()
 * - 总结调用使用 LLMClient.sendSystemMessage() 直接调用，不注册工具
 * - 边界标记为 JSON 格式 system 消息
 */
export class CompactService {
  constructor(
    private llmClient: LLMClient,
    private registry: PluginRegistry,
    private display?: DisplayManager,
  ) {}

  /**
   * 执行压缩（基于 agent 实例）。
   */
  async compact(agent: NanoCodeAgent, options?: CompactOptions): Promise<CompactionResult> {
    const history = agent.getHistory();
    return this.compactMessages(history, options);
  }

  /**
   * 执行压缩（基于原始消息数组，无需 agent 引用）。
   */
  async compactRaw(messages: ChatMessage[], options?: CompactOptions): Promise<CompactionResult> {
    return this.compactMessages(messages, options);
  }

  /**
   * 执行压缩，返回可用于替换 messageHistory 的新消息数组。
   */
  private async compactMessages(history: ChatMessage[], options?: CompactOptions): Promise<CompactionResult> {
    if (history.length === 0) {
      throw new Error('没有可压缩的消息');
    }

    const preserveCount = options?.preserveCount ?? 2;
    const { toSummarize, toPreserve } = this.splitMessages(history, preserveCount);

    const originalTokens = countMessagesTokens(history);
    const originalMessageCount = history.length;

    // ── Dry-run ──
    if (options?.dryRun) {
      const boundary = this.buildBoundaryMarker('(dry-run)', originalMessageCount);
      const summaryMsg: ChatMessage = {
        role: 'user',
        content: formatCompactSummaryMessage('(dry-run: summary not generated)'),
      };
      const newMsgs = [boundary, summaryMsg, ...toPreserve];
      return {
        messages: [],
        summary: '',
        originalMessageCount,
        compactedMessageCount: newMsgs.length,
        originalTokens,
        compactedTokens: countMessagesTokens(newMsgs),
        savedTokens: originalTokens - countMessagesTokens(newMsgs),
      };
    }

    // ── 生成摘要 ──
    this.display?.onStatus({ message: '正在生成对话摘要...', agentName: 'main' });

    const summary = await this.generateSummary(toSummarize, options?.summaryModel, options?.customInstructions);

    // ── 组装新消息数组 ──
    const boundary = this.buildBoundaryMarker(summary, originalMessageCount);
    const summaryMsg: ChatMessage = {
      role: 'user',
      content: formatCompactSummaryMessage(summary),
    };
    const newMessages: ChatMessage[] = [boundary, summaryMsg, ...toPreserve];

    // ── 注入文件缓存 ──
    const fileCacheEntries = this.getFileReadCacheMessages();
    newMessages.push(...fileCacheEntries);

    const compactedTokens = countMessagesTokens(newMessages);

    return {
      messages: newMessages,
      summary,
      originalMessageCount,
      compactedMessageCount: newMessages.length,
      originalTokens,
      compactedTokens,
      savedTokens: originalTokens - compactedTokens,
    };
  }

  // ── Private ──

  /** 压缩边界标记：system 消息，JSON 格式 */
  private buildBoundaryMarker(summary: string, messageCount: number): ChatMessage {
    return {
      role: 'system',
      content: JSON.stringify({
        type: 'compact_boundary',
        summary: summary.slice(0, 500),
        originalMessageCount: messageCount,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  /**
   * 分割历史：
   * - toSummarize：需要被总结的旧消息
   * - toPreserve：保留原样的最近消息（preserveCount 组 user→assistant 对话）
   *
   * 一组对话 = user message + 后续的 assistant + tool 消息。
   */
  private splitMessages(
    history: ChatMessage[],
    preserveCount: number,
  ): { toSummarize: ChatMessage[]; toPreserve: ChatMessage[] } {
    if (preserveCount <= 0 || history.length === 0) {
      return { toSummarize: history, toPreserve: [] };
    }

    // 从后往前数 preserveCount 个 user 消息
    let userCount = 0;
    let splitIndex = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') {
        userCount++;
        if (userCount >= preserveCount) {
          // 从这个 user 消息开始保留（包括它自己）
          splitIndex = i;
          break;
        }
      }
      if (i === 0) {
        splitIndex = 0; // 全部保留
      }
    }

    return {
      toSummarize: history.slice(0, splitIndex),
      toPreserve: history.slice(splitIndex),
    };
  }

  /** 移除消息中的图片 base64 数据，减轻总结调用载荷 */
  private stripImages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => {
      if (!msg.content) return msg;
      const stripped = msg.content
        .replace(/!\[.*?\]\(data:image\/[^)]+\)/g, '[image]')
        .replace(/data:image\/[^;]+;base64[^"]+/g, '[image data]');
      return { ...msg, content: stripped };
    });
  }

  /**
   * 调用 LLM 生成摘要。
   * 使用 LLMClient.sendSystemMessage() 直接调用，不注册任何工具。
   */
  private async generateSummary(
    messages: ChatMessage[],
    modelOverride?: string,
    customInstructions?: string,
  ): Promise<string> {
    const stripped = this.stripImages(messages);
    const userPrompt = buildCompactUserPrompt(stripped);

    let systemContent = COMPACT_SYSTEM_PROMPT;
    if (customInstructions?.trim()) {
      systemContent += `\n\nAdditional Instructions:\n${customInstructions.trim()}`;
    }

    const systemMsg: ChatMessage = { role: 'system', content: systemContent };
    const userMsg: ChatMessage = { role: 'user', content: userPrompt };

    const extraParams: Record<string, unknown> = {};
    if (modelOverride) {
      extraParams.model = modelOverride;
    }

    let accumulatedText = '';
    const onChunk = (chunk: string) => { accumulatedText += chunk; };

    const response = await this.llmClient.sendSystemMessage(
      [systemMsg, userMsg],
      [],        // No tools for summarization
      onChunk,
      extraParams,
    );

    const raw = response.text || accumulatedText;
    const summary = extractSummary(raw);
    return summary || raw.slice(0, 2000);
  }

  /** 获取最近读取的文件内容，注入为用户消息 */
  private getFileReadCacheMessages(): ChatMessage[] {
    const getCache = this.registry.store.get<() => Array<{ path: string; content: string }>>('fs:readCache');
    if (!getCache) return [];
    const cache = getCache();
    if (!cache || cache.length === 0) return [];

    return cache.map(entry => ({
      role: 'user' as const,
      content: `[Previously read file: ${entry.path}]\n\`\`\`\n${entry.content}\n\`\`\``,
    }));
  }
}
