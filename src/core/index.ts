/**
 * nano-code 核心层公共 API
 *
 * 只暴露接口类型和核心类，不暴露任何插件实现。
 */

// ── 插件体系 ──
export { NanoPlugin, PluginRegistry, registerBuiltinPlugin } from '#src/core/plugin.js';

// ── Agent ──
export { NanoCodeAgent } from '#src/core/agent.js';
export type { NanoCodeAgentOptions } from '#src/core/agent.js';
export { AgentManager } from '#src/core/agent-manager.js';
export type { AgentInfo, CreateAgentOptions } from '#src/core/contract.js';

// ── 合约类型 ──
export type {
  ToolResponse,
  ToolStatus,
  ToolDefinition,
  ToolCall,
  ToolContext,
  LLMResponse,
  DiffHunk,
  DiffLine,
  PermissionConfirmRequest,
  PermissionConfirmResponse,
  CommandOutputHandler,
  CommandInterceptResult,
  InjectedMessage,
  AgentDisplay,
} from '#src/core/contract.js';
export { isMainAgent } from '#src/core/contract.js';

// ── LLM 客户端 ──
export { LLMClient } from '#src/core/llm.js';
export type { LLMConfig, ChatMessage, ToolCallDelta } from '#src/core/llm.js';

// ── 提示词构建 ──
export { buildSystemPrompt, formatToolResponse } from '#src/core/prompt.js';

// ── 配置（仅类型） ──
export type { NanoConfig, SystemPromptConfig, AgentConfig, PluginConfigEntry } from '#src/core/config.js';

// ── 会话 ──
export { saveSession, loadSession, hasSession } from '#src/bootstrap/session.js';
export type { SessionData } from '#src/bootstrap/session.js';

// ── 存储 ──
export { InMemoryStore } from '#src/core/store.js';
export type { IStore } from '#src/core/store.js';

// ── 常量 ──
export { SK } from '#src/core/store-keys.js';
export type { AgentModeInfo } from '#src/core/store-keys.js';

// ── 版本 ──
export { getPackageVersion, getPackageName } from '#src/utils/version.js';

// ── 工具名格式化 ──
export { getToolDisplayName } from '#src/utils/tool-name.js';

// ── 重试工具 ──
export { withRetry } from '#src/utils/retry.js';
export type { RetryOptions } from '#src/utils/retry.js';

// ── 日志 ──
export { logManager } from '#src/utils/logger.js';
export type { LogPlugin, LogEntry, LogLevel } from '#src/utils/logger.js';

