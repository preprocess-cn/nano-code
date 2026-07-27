import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition, ToolCall, LLMResponse, type SessionRestoreContext } from '#src/core/contract.js';
import { ChatMessage } from '#src/core/llm.js';
import { countMessagesTokens, initTokenizer, roughTokenCountEstimation } from '#src/plugins/token-budget/counter.js';
import type { LLMClient } from '#src/core/llm.js';
import type { DisplayOutput } from '#src/display.js';
import { SK, tokenBudgetKey, agentMessagesKey, compactResultKey, compactCompletedKey, compactRetryKey } from '#src/store-keys.js';
import { logManager } from '#src/utils/logger.js';

// ── Plugin ──

export interface TokenBudgetConfig {
  maxTokensPerSession?: number;    // Default: 100000
  maxTokensPerRequest?: number;    // Default: 8000
  compressionThreshold?: number;   // Default: 80000 — start warning at this level
  warnAtTokens?: number;           // Default: 50000 — first warning level
  /** 自动压缩阈值（0 = 回退到 maxContextLength * contextWindowRatio），超出后在 onAfterRequest 设置 compact:signal */
  autoCompactThreshold?: number;
  /** 是否启用自动压缩（默认 false，opt-in） */
  autoCompactEnabled?: boolean;
  /** LLM 客户端引用（自动压缩需要） */
  llmClient?: LLMClient;
  /** 展示管理器引用（自动压缩需要） */
  displayMgr?: DisplayOutput;
  /** 模型最大上下文长度，用于计算 auto-compact 和硬上限。默认 100000 */
  maxContextLength?: number;
  /** auto-compact 阈值 = maxContextLength * contextWindowRatio。默认 0.7 */
  contextWindowRatio?: number;
  /** 硬上限 = maxContextLength * contextWindowHardLimit。默认 0.95 */
  contextWindowHardLimit?: number;
}

export function createTokenBudgetPlugin(config?: TokenBudgetConfig): NanoPlugin {
  const cfg = {
    maxTokensPerSession: config?.maxTokensPerSession ?? 100000,
    maxTokensPerRequest: config?.maxTokensPerRequest ?? 8000,
    compressionThreshold: config?.compressionThreshold ?? 80000,
    warnAtTokens: config?.warnAtTokens ?? 50000,
    autoCompactThreshold: config?.autoCompactThreshold ?? 0,
    autoCompactEnabled: config?.autoCompactEnabled ?? true,
    llmClient: config?.llmClient,
    displayMgr: config?.displayMgr,
    maxContextLength: config?.maxContextLength ?? 100000,
    contextWindowRatio: config?.contextWindowRatio ?? 0.7,
    contextWindowHardLimit: config?.contextWindowHardLimit ?? 0.95,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokensAccumulated = 0;

  // 当前上下文窗口（最后一次 API 响应的 prompt 侧数据，非累计）
  let lastUsage = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  let warned = false;
  let compressed = false;
  let _registryRef: PluginRegistry | null = null;
  const _agentName = (): string => _registryRef?.getAgentName() ?? 'main';

  // ── Auto-compact helper (fire-and-forget, runs outside the request lifecycle) ──
  const runCompact = async (llm: LLMClient, display: DisplayOutput, reg: PluginRegistry | null) => {
    if (!reg) return;
    const name = reg.getAgentName();
    const messages = reg.store.get<ChatMessage[]>(agentMessagesKey(name));
    if (!messages || messages.length === 0) return;
    try {
      const { CompactService } = await import('#src/plugins/compact/service.js');
      const service = new CompactService(llm, reg, display);
      const result = await service.compactRaw(messages, { preserveCount: 2 });
      reg.store.set(compactResultKey(name), result.messages);
      reg.store.set(compactCompletedKey(name), true);
      display.onStatus({
        message: `自动压缩: ${result.originalMessageCount} → ${result.compactedMessageCount} 条消息, 节省 ~${(result.savedTokens / 1000).toFixed(1)}K tokens`,
        agentName: name,
        level: 'info',
      });
    } catch {
      reg.store.set(compactRetryKey(name), true);
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
      if (registryConfig.maxContextLength !== undefined) cfg.maxContextLength = registryConfig.maxContextLength;
      if (registryConfig.contextWindowRatio !== undefined) cfg.contextWindowRatio = registryConfig.contextWindowRatio;
      if (registryConfig.contextWindowHardLimit !== undefined) cfg.contextWindowHardLimit = registryConfig.contextWindowHardLimit;

      // 环境变量覆盖（符合 Shell env > YAML 的配置优先级）
      const envMaxContextLength = process.env.NANO_CODE_MAX_CONTEXT_LENGTH;
      if (envMaxContextLength) {
        const parsed = parseInt(envMaxContextLength, 10);
        if (!isNaN(parsed) && parsed > 0) cfg.maxContextLength = parsed;
      }

      inputTokens = 0;
      outputTokens = 0;
      totalTokensAccumulated = 0;
      warned = false;
      compressed = false;

      // 从 store 读取初始累计值（--continue 恢复的会话）
      const initialAccumulated = _registry.store.get<number>(SK.TokenBudgetInitialAccumulated);
      if (initialAccumulated) {
        totalTokensAccumulated += initialAccumulated;
      }

      const name = _agentName();

      // Expose getApiUsage for main agent only — sub-agents each have their
      // own token-budget instance and would overwrite the shared store key.
      if (name === 'main') {
        _registry.store.set(SK.TokenBudgetGetApiUsage, () => ({
          inputTokens,
          outputTokens,
          totalTokens: totalTokensAccumulated,
        }));
      }

      // Write per-agent token key for agent-tracker consumption
      _registry.store.set(tokenBudgetKey(name), () => ({
        totalTokens: totalTokensAccumulated,
      }));

      // Register removeAgent cleanup interface for agent-tool's finally block
      _registry.store.set(SK.TokenBudgetRemoveAgent, (agentName: string) => {
        _registry.store.set(tokenBudgetKey(agentName), undefined as any);
      });

      // 暴露当前上下文窗口使用量（最后一次 API 响应的 prompt 侧）
      _registry.store.set(SK.TokenBudgetGetCurrentUsage, () => ({ ...lastUsage }));

      // Initialize auto-compact signals
      _registry.store.set(SK.CompactSignal, false);
      _registry.store.set(compactCompletedKey(name), false);
      _registry.store.set(compactRetryKey(name), false);
    },

    async onSessionRestore(ctx: SessionRestoreContext): Promise<void> {
      const tokens = countMessagesTokens(ctx.messages);
      ctx.store.set(SK.TokenBudgetInitialAccumulated, tokens);
    },

    onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
      const estimated = countMessagesTokens(messages);

      // Check context window hard limit — prevent 400 errors from overflow
      // Must be checked BEFORE maxTokensPerRequest: a context-overflowing request
      // also exceeds the per-request limit, so the hard limit check would be dead code.
      const hardLimit = Math.floor(cfg.maxContextLength * cfg.contextWindowHardLimit);
      if (estimated > hardLimit) {
        logManager.warn('token-budget', `请求上下文大小 (~${estimated} tokens) 超过硬上限 (${hardLimit})，注入停止指令`);
        return [
          ...messages,
          {
            role: 'user',
            content: '<system-reminder>\n上下文窗口已满。请立即结束当前任务，总结已完成的工作，不要再调用任何工具。\n</system-reminder>',
            isMeta: true,
          },
        ];
      }

      // Check single-request limit
      if (estimated > cfg.maxTokensPerRequest) {
        logManager.warn('token-budget', `请求过大 (~${estimated} tokens)，添加压缩指令`);
        return [
          ...messages,
          {
            role: 'user',
            content: '<system-reminder>\n注意：当前请求消息过长。请优先关注最近的消息，回复尽量简洁。\n</system-reminder>',
            isMeta: true,
          },
        ];
      }

      // Check session limit — hard stop
      if (totalTokensAccumulated + estimated > cfg.maxTokensPerSession) {
        logManager.warn('token-budget', `会话预算已超 (${totalTokensAccumulated + estimated}/${cfg.maxTokensPerSession})，终止工具调用`);
        return [
          ...messages,
          {
            role: 'user',
            content: `<system-reminder>\nThis session has exceeded its token budget (${cfg.maxTokensPerSession}). You must NOT call any more tools. Please summarize what was accomplished and suggest next steps the user can take manually.\n</system-reminder>`,
            isMeta: true,
          },
        ];
      }

      // Warning at threshold
      if (!warned && totalTokensAccumulated > cfg.warnAtTokens) {
        warned = true;
        logManager.warn('token-budget', `已使用 ${totalTokensAccumulated} tokens，接近预算 (${cfg.maxTokensPerSession})`);
      }

      // Compression hint at threshold
      if (!compressed && totalTokensAccumulated > cfg.compressionThreshold) {
        compressed = true;
        return [
          ...messages,
          {
            role: 'user',
            content: '<system-reminder>\n注意：当前会话较长，请尽量简洁回复，避免不必要的工具调用。\n</system-reminder>',
            isMeta: true,
          },
        ];
      }

      return messages;
    },

    onAfterRequest(response: LLMResponse, rawMeta?: Record<string, unknown>, requestMessages?: ChatMessage[]): void {
      if (rawMeta?.promptTokens != null) {
        // 会话累计（不变）
        inputTokens += rawMeta.promptTokens as number;
        outputTokens += rawMeta.completionTokens as number;
        totalTokensAccumulated += rawMeta.totalTokens as number;

        // 当前上下文窗口（替换式存储，非累计）
        lastUsage = {
          inputTokens: rawMeta.promptTokens as number,
          cacheCreationTokens: (rawMeta as any).cacheCreationTokens ?? 0,
          cacheReadTokens: (rawMeta as any).cacheReadTokens ?? 0,
        };
      } else {
        // Fallback: 同时估算 input 和 output
        const estInput = countMessagesTokens(requestMessages ?? []);
        const estOutput = roughTokenCountEstimation(response.text ?? '', 4);
        inputTokens += estInput;
        outputTokens += estOutput;
        totalTokensAccumulated += estInput + estOutput;

        lastUsage = { inputTokens: estInput, cacheCreationTokens: 0, cacheReadTokens: 0 };
      }

      const name = _agentName();
      // 更新 per-agent token 累计值（供 display 层读取）
      if (_registryRef) {
        _registryRef.store.set(tokenBudgetKey(name), () => ({
          totalTokens: totalTokensAccumulated,
        }));
      }

      // 失败重试信号清理
      if (_registryRef) {
        _registryRef.store.set(compactRetryKey(name), false);
      }

      // Auto-compact: 基于当前消息历史实际大小触发，而非累计总值。
      // 压缩后消息减小，下次再超阈值才再次触发（slide window 效果）。
      if (cfg.autoCompactEnabled && cfg.llmClient && cfg.displayMgr && _registryRef) {
        // 已有待消费的压缩结果时不再触发（避免并发重入）
        if (!_registryRef.store.get(compactResultKey(name))) {
          const messages = _registryRef.store.get<ChatMessage[]>(agentMessagesKey(name));
          if (messages && messages.length > 0) {
            const currentTokens = countMessagesTokens(messages);
            const threshold = cfg.autoCompactThreshold > 0
              ? cfg.autoCompactThreshold
              : cfg.maxContextLength * cfg.contextWindowRatio;
            if (currentTokens > threshold) {
              runCompact(cfg.llmClient, cfg.displayMgr, _registryRef);
            }
          }
        }
      }
    },

  };
}
