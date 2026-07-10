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

// ── Per-agent 动态键（共享 store 下按 agent 名隔离） ──
export const agentStatusKey = (name: string): string => `agent:status:${name}`;
export const agentAbortKey = (name: string): string => `agent:abort:${name}`;
export const agentMessagesKey = (name: string): string => `agent:messages:${name}`;
export const agentCancelledKey = (name: string): string => `agent:cancelled:${name}`;
export const compactResultKey = (name: string): string => `compact:result:${name}`;
export const compactCompletedKey = (name: string): string => `compact:completed:${name}`;
export const compactRetryKey = (name: string): string => `compact:retry:${name}`;

export const SK = {
  /** AgentManager 实例引用（存入共享 store 供插件获取） */
  AgentManager: 'agent:manager',
  /** @deprecated 使用 agentStatusKey(name) 替代 */
  AgentStatus: 'agent',
  /** @deprecated 使用 agentCancelledKey(name) 替代 */
  AgentCancelled: 'agent:cancelled',
  /** @deprecated 使用 agentAbortKey(name) 替代 */
  AgentAbort: 'agent:abort',
  /** @deprecated 使用 agentMessagesKey(name) 替代 */
  AgentMessages: 'agent:messages',
  /** @deprecated 使用 compactResultKey(name) 替代 */
  CompactResult: 'compact:result',
  /** boolean: 自动压缩信号 */
  CompactSignal: 'compact:signal',
  /** @deprecated 使用 compactCompletedKey(name) 替代 */
  CompactCompleted: 'compact:completed',
  /** @deprecated 使用 compactRetryKey(name) 替代 */
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
  /** PlanMode: plan 模式之前的模式（退出时恢复） */
  PrePlanMode: 'task-plan:preMode',
  /** string: 计划文件内容 */
  PlanContent: 'task-plan:planContent',
  /** boolean: 计划是否已批准（exit_plan_mode 成功时设为 true） */
  PlanApproved: 'task-plan:planApproved',

  /** string: 当前计划文件路径（~/.nano-code/plan/<name>.md） */
  CurrentPlanPath: 'task-plan:currentPlanPath',
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

  // ── Model registry (model-registry plugin) ──
  /** ModelEntry: 当前请求应使用的模型覆盖配置 */
  ModelOverride: 'model:override',
  /** ModelEntry[]: model-registry 中已解析的全部模型条目（用于 /model 命令和 --model CLI） */
  ModelRegistryModels: 'model-registry:models',

  // ── View switching (Ink display) ──
  /** string | undefined: 当前正在查看的 agent（如 sub_agent_name），undefined = 主视图 */
  ViewAgent: 'view:agent',

  // ── Notify manager ──
  /** (source: string, message: string) => boolean: 发送通知，返回 true 表示入队成功 */
  NotifySend: 'notify:send',
} as const;

export interface AgentModeInfo {
  name: string;
  description: string;
}
