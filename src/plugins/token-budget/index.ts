import { NanoPlugin, PluginRegistry, ToolCall, LLMResponse } from '../../plugin.js';
import { ToolResponse, ToolContext, ToolDefinition } from '../../contract.js';
import { ChatMessage } from '../../llm.js';
import { countMessagesTokens } from './counter.js';
import { initTokenizer } from './counter.js';
import type { LLMClient } from '../../llm.js';
import type { DisplayManager } from '../../display.js';

// ── Plugin ──

export interface TokenBudgetConfig {
  maxTokensPerSession?: number;    // Default: 100000
  maxTokensPerRequest?: number;    // Default: 8000
  compressionThreshold?: number;   // Default: 80000 — start warning at this level
  warnAtTokens?: number;           // Default: 50000 — first warning level
  /** 自动压缩阈值（默认 maxTokensPerSession * 0.9），超出后在 onAfterRequest 设置 compact:signal */
  autoCompactThreshold?: number;
  /** 是否启用自动压缩（默认 false，opt-in） */
  autoCompactEnabled?: boolean;
  /** LLM 客户端引用（自动压缩需要） */
  llmClient?: LLMClient;
  /** 展示管理器引用（自动压缩需要） */
  displayMgr?: DisplayManager;
}

export function createTokenBudgetPlugin(config?: TokenBudgetConfig): NanoPlugin {
  const cfg = {
    maxTokensPerSession: config?.maxTokensPerSession ?? 100000,
    maxTokensPerRequest: config?.maxTokensPerRequest ?? 8000,
    compressionThreshold: config?.compressionThreshold ?? 80000,
    warnAtTokens: config?.warnAtTokens ?? 50000,
    autoCompactThreshold: config?.autoCompactThreshold ?? 0,
    autoCompactEnabled: config?.autoCompactEnabled ?? false,
    llmClient: config?.llmClient,
    displayMgr: config?.displayMgr,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokensAccumulated = 0;
  let warned = false;
  let compressed = false;
  let autoCompacted = false;
  let _registryRef: PluginRegistry | null = null;

  // ── Auto-compact helper (fire-and-forget, runs outside the request lifecycle) ──
  const runCompact = async (llm: LLMClient, display: DisplayManager, reg: PluginRegistry | null) => {
    if (!reg) return;
    const messages = reg.store.get<ChatMessage[]>('agent:messages');
    if (!messages || messages.length === 0) return;
    try {
      const { CompactService } = await import('../../plugins/compact/service.js');
      const service = new CompactService(llm, reg, display);
      const result = await service.compactRaw(messages, { preserveCount: 2 });
      reg.store.set('compact:result', result.messages);
      reg.store.set('compact:completed', true);
      display.onStatus({
        message: `自动压缩: ${result.originalMessageCount} → ${result.compactedMessageCount} 条消息, 节省 ~${(result.savedTokens / 1000).toFixed(1)}K tokens`,
        agentName: 'main',
      });
    } catch {
      reg.store.set('compact:retry', true);
      autoCompacted = false;
    }
  };

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
      // Warm up tokenizer
      await initTokenizer();

      _registryRef = _registry;

      // Load config from registry if available
      const registryConfig = _registry.getPluginConfig('token-budget') as TokenBudgetConfig;
      if (registryConfig.maxTokensPerSession) cfg.maxTokensPerSession = registryConfig.maxTokensPerSession;
      if (registryConfig.maxTokensPerRequest) cfg.maxTokensPerRequest = registryConfig.maxTokensPerRequest;
      if (registryConfig.compressionThreshold) cfg.compressionThreshold = registryConfig.compressionThreshold;
      if (registryConfig.warnAtTokens) cfg.warnAtTokens = registryConfig.warnAtTokens;
      if (registryConfig.autoCompactThreshold !== undefined) cfg.autoCompactThreshold = registryConfig.autoCompactThreshold;
      if (registryConfig.autoCompactEnabled !== undefined) cfg.autoCompactEnabled = registryConfig.autoCompactEnabled;

      inputTokens = 0;
      outputTokens = 0;
      totalTokensAccumulated = 0;
      warned = false;
      compressed = false;
      autoCompacted = false;

      // 从 store 读取初始累计值（--continue 恢复的会话）
      const initialAccumulated = _registry.store.get<number>('token-budget:initialAccumulated');
      if (initialAccumulated) {
        totalTokensAccumulated += initialAccumulated;
      }

      // Expose getApiUsage via shared store for other plugins (e.g. /context)
      _registry.store.set('token-budget:getApiUsage', () => ({
        inputTokens,
        outputTokens,
        totalTokens: totalTokensAccumulated,
      }));

      // Initialize auto-compact signals
      _registry.store.set('compact:signal', false);
      _registry.store.set('compact:completed', false);
      _registry.store.set('compact:retry', false);
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
      if (totalTokensAccumulated + estimated > cfg.maxTokensPerSession) {
        console.warn(`\n[token-budget] 会话预算已超 (${totalTokensAccumulated + estimated}/${cfg.maxTokensPerSession})，终止工具调用`);
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
      if (!warned && totalTokensAccumulated > cfg.warnAtTokens) {
        warned = true;
        console.warn(`\n[token-budget] 已使用 ${totalTokensAccumulated} tokens，接近预算 (${cfg.maxTokensPerSession})`);
      }

      // Compression hint at threshold
      if (!compressed && totalTokensAccumulated > cfg.compressionThreshold) {
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
        // Use exact token counts from API response (priority 1)
        inputTokens += rawMeta.promptTokens as number;
        outputTokens += rawMeta.completionTokens as number;
        totalTokensAccumulated += rawMeta.totalTokens as number;
      } else {
        // Fallback estimation when API doesn't return usage
        const responseText = response.text || '';
        const estOutput = Math.ceil(responseText.length / 3);
        outputTokens += estOutput;
        totalTokensAccumulated = inputTokens + outputTokens;
      }

      // 失败重试：主循环 catch 块设置 compact:retry，此处重置 autoCompacted
      if (_registryRef?.store.get('compact:retry')) {
        autoCompacted = false;
        _registryRef.store.set('compact:retry', false);
      }

      // Auto-compact: run compact directly from the plugin
      if (cfg.autoCompactEnabled && !autoCompacted && cfg.llmClient && cfg.displayMgr) {
        const threshold = cfg.autoCompactThreshold > 0
          ? cfg.autoCompactThreshold
          : cfg.maxTokensPerSession * 0.9;
        if (totalTokensAccumulated > threshold) {
          autoCompacted = true;
          runCompact(cfg.llmClient, cfg.displayMgr, _registryRef);
        }
      }
    },

    onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
      // Reject tool calls if over budget
      if (totalTokensAccumulated > cfg.maxTokensPerSession) {
        console.warn(`[token-budget] 预算耗尽，拒绝工具调用: ${toolCall.function.name}`);
        return null;
      }
      return toolCall;
    },
  };
}
