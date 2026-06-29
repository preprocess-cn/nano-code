/**
 * nano-code 核心层公共 API
 *
 * 只暴露接口类型和核心类，不暴露任何插件实现。
 */

// ── 插件体系 ──
export { NanoPlugin, PluginRegistry, registerBuiltinPlugin } from './plugin.js';
export type { LLMResponse, ToolCall } from './plugin.js';

// ── Agent ──
export { NanoCodeAgent } from './agent.js';
export type { NanoCodeAgentOptions } from './agent.js';

// ── 合约类型 ──
export type {
  ToolResponse,
  ToolStatus,
  ToolDefinition,
  ToolContext,
  DiffHunk,
  DiffLine,
  PermissionConfirmRequest,
  PermissionConfirmResponse,
  CommandOutputHandler,
  CommandInterceptResult,
  InjectedMessage,
} from './contract.js';
export { isMainAgent } from './contract.js';

// ── LLM 客户端 ──
export { LLMClient } from './llm.js';
export type { LLMConfig, ChatMessage, ToolCallDelta, AssembledToolCall } from './llm.js';

// ── 提示词构建 ──
export { buildSystemPrompt, formatToolResponse } from './prompt.js';

// ── 配置 ──
export { loadConfig, applyProfile, getSystemWhitelist } from './config.js';
export type { NanoConfig, SystemPromptConfig, AgentConfig, PluginConfigEntry } from './config.js';

// ── 会话 ──
export { saveSession, loadSession, hasSession } from './session.js';
export type { SessionData } from './session.js';

// ── 存储 ──
export { InMemoryStore } from './store.js';
export type { IStore } from './store.js';

// ── 常量 ──
export { SK } from './store-keys.js';
export type { AgentModeInfo } from './store-keys.js';

// ── 版本 ──
export { getPackageVersion, getPackageName } from './version.js';

// ── 日志 ──
export { logManager } from './logger.js';
export type { LogPlugin, LogEntry, LogLevel } from './logger.js';

// ── 诊断 ──
export { runDoctor, formatDoctorResults } from './doctor.js';
export type { DoctorResult } from './doctor.js';
