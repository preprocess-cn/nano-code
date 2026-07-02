/**
 * 集中管理所有 Store key 常量。
 *
 * 所有基于 IStore 的读写必须使用此文件中定义的 key，
 * 使 Store 上承载的隐式协议显式化、可追踪。
 *
 * 新增一个 Store key 的步骤：
 * 1. 在 SK 对象中加一个常量
 * 2. 所有 get/set 使用 store.get(SK.XXX) / store.set(SK.XXX, value)
 */

import type { ChatMessage } from '#src/core/llm.js';

export const SK = {
  /** 当前 agent 状态快照 */
  AgentStatus: 'agent',
  /** Boolean: 是否收到取消信号 */
  AgentCancelled: 'agent:cancelled',
  /** AbortController: LLM 流式请求的中止控制器 */
  AgentAbort: 'agent:abort',
  /** ChatMessage[]: 当前 agent 的消息历史快照 */
  AgentMessages: 'agent:messages',
  /** ChatMessage[]: 自动压缩结果 */
  CompactResult: 'compact:result',
  /** boolean: 自动压缩信号 */
  CompactSignal: 'compact:signal',
  /** boolean: 压缩是否已完成 */
  CompactCompleted: 'compact:completed',
  /** boolean: 压缩是否需要重试 */
  CompactRetry: 'compact:retry',
  /** number: 从 session 恢复时的初始累计 token */
  TokenBudgetInitialAccumulated: 'token-budget:initialAccumulated',
  /** () => { prompt, completion }: 获取当前 API token 用量 */
  TokenBudgetGetApiUsage: 'token-budget:getApiUsage',
  /** () => ReadCacheEntry[]: 获取文件读取缓存 */
  FsReadCache: 'fs:readCache',
  /** { name, description } | undefined: 当前活跃的 agent-slash 模式 */
  AgentMode: 'agent:mode',
  /** PlanMode: 当前 agent 模式 */
  Mode: 'task-plan:mode',
  /** string: 计划文件内容 */
  PlanContent: 'task-plan:planContent',
  /** Task[]: 当前任务列表 */
  Tasks: 'task-plan:tasks',
  /** number: 任务数量 */
  TaskCount: 'task-plan:taskCount',

  // ── Memory paths (set by memory plugin, read by analyzer) ──
  /** string: 项目记忆目录路径 ~/.nano-code/projects/<sanitized>/ */
  MemoryProjectDir: 'memory:projectDir',
  /** string: MEMORY.md 索引文件路径 */
  MemoryIndexPath: 'memory:indexPath',
  /** string: ~/.nano-code/AGENT.md 用户全局文件路径 */
  MemoryUserGlobalPath: 'memory:userGlobalPath',
} as const;

export interface AgentModeInfo {
  name: string;
  description: string;
}
