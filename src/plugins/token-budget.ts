import { NanoPlugin, PluginRegistry, ToolCall, LLMResponse } from '../plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from '../contract.js';
import { ChatMessage } from '../llm.js';

// ── Token estimation (fallback when API doesn't return usage) ──

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function countMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content || '');
    total += 4; // overhead per message for role markers
  }
  return total;
}

// ── Plugin ──

export interface TokenBudgetConfig {
  maxTokensPerSession?: number;    // Default: 100000
  maxTokensPerRequest?: number;    // Default: 8000
  compressionThreshold?: number;   // Default: 80000 — start warning at this level
  warnAtTokens?: number;           // Default: 50000 — first warning level
}

export function createTokenBudgetPlugin(config?: TokenBudgetConfig): NanoPlugin {
  const cfg: Required<TokenBudgetConfig> = {
    maxTokensPerSession: config?.maxTokensPerSession ?? 100000,
    maxTokensPerRequest: config?.maxTokensPerRequest ?? 8000,
    compressionThreshold: config?.compressionThreshold ?? 80000,
    warnAtTokens: config?.warnAtTokens ?? 50000,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let warned = false;
  let compressed = false;

  return {
    name: 'token-budget',
    description: '追踪和管理 Token 用量，防止超出预算',

    getTools(): ToolDefinition[] {
      return [];  // No tools — hooks only
    },

    async execute(_name: string, _args: any, _ctx: ToolContext): Promise<ToolResponse> {
      return { status: 'error', message: 'token-budget plugin provides no tools' };
    },

    async onInit(_registry: PluginRegistry): Promise<void> {
      // Load config from registry if available
      const registryConfig = _registry.getPluginConfig('token-budget') as TokenBudgetConfig;
      if (registryConfig.maxTokensPerSession) cfg.maxTokensPerSession = registryConfig.maxTokensPerSession;
      if (registryConfig.maxTokensPerRequest) cfg.maxTokensPerRequest = registryConfig.maxTokensPerRequest;
      if (registryConfig.compressionThreshold) cfg.compressionThreshold = registryConfig.compressionThreshold;
      if (registryConfig.warnAtTokens) cfg.warnAtTokens = registryConfig.warnAtTokens;

      inputTokens = 0;
      outputTokens = 0;
      totalTokens = 0;
      warned = false;
      compressed = false;
    },

    onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
      const estimated = countMessagesTokens(messages);

      // Check single-request limit
      if (estimated > cfg.maxTokensPerRequest) {
        console.warn(`\n[token-budget] 请求过大 (~${estimated} tokens)，添加压缩指令`);
        return [
          ...messages,
          {
            role: 'user',
            content: '注意：当前请求消息过长。请优先关注最近的消息，回复尽量简洁。',
          },
        ];
      }

      // Check session limit — hard stop
      if (totalTokens + estimated > cfg.maxTokensPerSession) {
        console.warn(`\n[token-budget] 会话预算已超 (${totalTokens + estimated}/${cfg.maxTokensPerSession})，终止工具调用`);
        return [
          ...messages,
          {
            role: 'user',
            content: [
              `SYSTEM: This session has exceeded its token budget (${cfg.maxTokensPerSession}).`,
              'You must NOT call any more tools.',
              'Please summarize what was accomplished and suggest next steps the user can take manually.',
            ].join(' '),
          },
        ];
      }

      // Warning at threshold
      if (!warned && totalTokens > cfg.warnAtTokens) {
        warned = true;
        console.warn(`\n[token-budget] 已使用 ${totalTokens} tokens，接近预算 (${cfg.maxTokensPerSession})`);
      }

      // Compression hint at threshold
      if (!compressed && totalTokens > cfg.compressionThreshold) {
        compressed = true;
        return [
          ...messages,
          {
            role: 'user',
            content: '注意：当前会话较长，请尽量简洁回复，避免不必要的工具调用。',
          },
        ];
      }

      return messages;
    },

    onAfterRequest(response: LLMResponse, rawMeta?: Record<string, unknown>): void {
      if (rawMeta?.promptTokens != null) {
        // Use exact token counts from API response
        inputTokens += rawMeta.promptTokens as number;
        outputTokens += rawMeta.completionTokens as number;
        totalTokens += rawMeta.totalTokens as number;
      } else {
        // Fallback estimation when API doesn't return usage
        const responseText = response.text || '';
        const estOutput = estimateTokens(responseText);
        outputTokens += estOutput;
        totalTokens = inputTokens + outputTokens;
      }
    },

    onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
      // Reject tool calls if over budget
      if (totalTokens > cfg.maxTokensPerSession) {
        console.warn(`[token-budget] 预算耗尽，拒绝工具调用: ${toolCall.function.name}`);
        return null;
      }
      return toolCall;
    },
  };
}
