import { ToolDefinition, ToolResponse, ToolContext, ToolCall, LLMResponse, CommandInterceptResult, type PermissionConfirmRequest, type PermissionConfirmResponse, type CommandOutputHandler, type AgentReadyContext, type SessionRestoreContext, type AgentExitContext } from '#src/core/contract.js';
import { logManager } from '#src/utils/logger.js';
import { ChatMessage } from '#src/core/llm.js';
import { IStore, InMemoryStore } from '#src/core/store.js';

// ── Plugin interface ──

export interface NanoPlugin {
  name: string;
  description?: string;
  version?: string;

  getTools(): ToolDefinition[];
  execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse>;

  onInit?(registry: PluginRegistry): Promise<void>;
  onDestroy?(): Promise<void>;

  onSystemPrompt?(prompt: string): string;
  onBeforeRequest?(messages: ChatMessage[]): ChatMessage[];
  /** rawMeta 是 LLM 层返回的原始元数据（如 token 用量），核心不知晓其结构，由插件自行解析 */
  onAfterRequest?(response: LLMResponse, rawMeta?: Record<string, unknown>): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;

  /**
   * 在用户输入发送给 agent 之前拦截处理。
   * 返回 { handled: true, ... } 表示插件已处理该输入，主循环据此决定后续行为。
   * 返回 null 表示插件不处理，交由后续插件或 agent。
   * 用于实现斜杠命令、! 前缀 bash 等直接处理。
   */
  onBeforeAgentInput?(input: string): Promise<CommandInterceptResult | null>;

  /** 返回额外参数注入到 LLM API 请求体中。核心只透传，不知晓参数含义 */
  onExtraParams?(): Record<string, unknown>;

  /** NanoCodeAgent 创建后触发，插件可在此获取 agent/display 引用 */
  onAgentReady?(context: AgentReadyContext): Promise<void>;

  /** Agent 退出时触发（runTask 结束）。插件可在此清理该 agent 衍生的资源（如 monitor 进程）。 */
  onAgentExit?(context: AgentExitContext): Promise<void>;

  /** --continue 恢复会话时触发，插件可恢复状态（如 token 计数） */
  onSessionRestore?(context: SessionRestoreContext): Promise<void>;
}

/**
 * 交互工具处理器。
 * 工具插件通过 registry.getInteractiveHandler(toolName) 获取，
 * display 插件通过 registry.registerInteractiveHandler(toolName, handler) 注册。
 * handler 接收工具原始 args，返回完整的 ToolResponse。
 */
export type InteractiveHandler = (args: any) => Promise<ToolResponse>;

// ── Plugin registry ──

export class PluginRegistry {
  private plugins: Map<string, NanoPlugin> = new Map();
  private toolIndex: Map<string, string> = new Map();
  private toolSideEffects: Map<string, boolean> = new Map();
  private toolTimeouts: Map<string, number | undefined> = new Map();
  private configs: Map<string, Record<string, any>> = new Map();
  private defaultCtx: Partial<ToolContext> = {};
  private agentName: string = 'main';
  private _confirmCallback?: (req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>;
  private _outputHandler?: CommandOutputHandler;
  private _schemaCache: ToolDefinition[] | null = null;
  private _interactiveHandlers: Map<string, InteractiveHandler> = new Map();

  /** 插件间共享状态通道。核心只做透传，不知晓任何 key 的业务含义 */
  store: IStore;

  constructor(options?: { store?: IStore }) {
    this.store = options?.store ?? new InMemoryStore();
  }

  /** 返回共享 store 中的 AgentManager（若有） */
  getAgentManager(): import('#src/core/agent-manager.js').AgentManager | undefined {
    return this.store.get('agent:manager') as import('#src/core/agent-manager.js').AgentManager | undefined;
  }

  setDefaultContext(ctx: Partial<ToolContext>): void {
    this.defaultCtx = ctx;
  }

  setConfirmCallback(cb: (req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>): void {
    this._confirmCallback = cb;
  }

  getConfirmCallback(): ((req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>) | undefined {
    return this._confirmCallback;
  }

  registerInteractiveHandler(toolName: string, handler: InteractiveHandler): void {
    this._interactiveHandlers.set(toolName, handler);
  }

  getInteractiveHandler(toolName: string): InteractiveHandler | undefined {
    return this._interactiveHandlers.get(toolName);
  }

  // ── Session-level allowlist ──
  // 工具级 Always Allow：用户确认一次后当前会话不再重复确认。
  // 不持久化，--continue 后 allowlist 为空，权限确认自然恢复。

  private _allowlist: Map<string, true> = new Map();
  /** 全局跳过所有权限确认（用于自动触发/后台任务的执行） */
  private _skipPermissionScope = false;

  /** 检查某工具是否已加入当前会话的 allowlist */
  isToolAllowed(toolName: string): boolean {
    return this._allowlist.has(toolName);
  }

  /** 将某工具加入当前会话的 allowlist */
  allowTool(toolName: string): void {
    this._allowlist.set(toolName, true);
  }

  /** 清空 allowlist（/permissions reset） */
  clearPermissions(): void {
    this._allowlist.clear();
  }

  /** 获取当前会话已允许的工具列表 */
  getAllowedTools(): string[] {
    return Array.from(this._allowlist.keys());
  }

  /** 设置全局跳过权限确认（自动执行（如插件触发）时使用） */
  setSkipPermissionScope(skip: boolean): void {
    this._skipPermissionScope = skip;
  }

  /** 当前是否处于全局跳过权限确认的作用域 */
  isSkipPermissionScope(): boolean {
    return this._skipPermissionScope;
  }

  /** 获取某工具的 sideEffect 标记 */
  getToolSideEffect(toolName: string): boolean {
    return this.toolSideEffects.get(toolName) ?? true;
  }

  setOutputHandler(handler: CommandOutputHandler): void {
    this._outputHandler = handler;
  }

  getOutputHandler(): CommandOutputHandler | undefined {
    return this._outputHandler;
  }

  setAgentName(name: string): void {
    this.agentName = name;
  }

  getAgentName(): string {
    return this.agentName;
  }

  async register(plugin: NanoPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      logManager.warn('plugin', `Plugin "${plugin.name}" is already registered, overwriting.`);
      await this.unregister(plugin.name);
    }

    this.plugins.set(plugin.name, plugin);
    for (const tool of plugin.getTools()) {
      if (this.toolIndex.has(tool.function.name)) {
        logManager.warn('plugin', `Tool "${tool.function.name}" already registered by plugin "${this.toolIndex.get(tool.function.name)}", overwritten by "${plugin.name}".`);
      }
      this.toolIndex.set(tool.function.name, plugin.name);
      this.toolSideEffects.set(tool.function.name, tool.function.sideEffect ?? true);
      this.toolTimeouts.set(tool.function.name, tool.function.timeout);
    }
    this._schemaCache = null;

    try {
      if (plugin.onInit) {
        await plugin.onInit(this);
      }
    } catch (err) {
      logManager.error('plugin', `onInit failed for "${plugin.name}":`, err);
    }
  }

  /** 销毁全部插件并清空注册表。用于进程退出时的全局清理。 */
  async destroy(): Promise<void> {
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      const plugin = this.plugins.get(name);
      if (!plugin) continue;
      try { await plugin.onDestroy?.(); }
      catch (err) { logManager.error('plugin', `onDestroy failed for "${name}":`, err); }
    }
    this.plugins.clear();
    this.toolIndex.clear();
    this.toolSideEffects.clear();
    this.toolTimeouts.clear();
    this.configs.clear();
    this._allowlist.clear();
    this._schemaCache = null;
    this._interactiveHandlers.clear();
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    try {
      if (plugin.onDestroy) {
        await plugin.onDestroy();
      }
    } catch (err) {
      logManager.error('plugin', `onDestroy failed for "${name}":`, err);
    }

    for (const [toolName, pluginName] of this.toolIndex.entries()) {
      if (pluginName === name) {
        this.toolIndex.delete(toolName);
        this.toolSideEffects.delete(toolName);
        this.toolTimeouts.delete(toolName);
      }
    }
    this.plugins.delete(name);
    this.configs.delete(name);
    this._schemaCache = null;
  }

  getAllSchemas(): ToolDefinition[] {
    if (this._schemaCache) return this._schemaCache;
    const schemas: ToolDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      schemas.push(...plugin.getTools());
    }
    this._schemaCache = schemas;
    return schemas;
  }

  async execute(name: string, args: any, ctx?: Partial<ToolContext>): Promise<ToolResponse> {
    const pluginName = this.toolIndex.get(name);
    if (!pluginName) {
      return {
        status: 'error',
        message: `未知工具 "${name}"。该工具不可用，可能是因为对应插件未启用。可通过 /doctor 检查插件状态。`,
      };
    }

    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return {
        status: 'error',
        message: `插件 "${pluginName}" 未找到。工具 "${name}" 所属的插件可能已被卸载或禁用。`,
      };
    }

    const toolTimeout = this.toolTimeouts.get(name);
    const effectiveTimeout = toolTimeout !== undefined ? toolTimeout : (ctx?.defaultTimeout ?? this.defaultCtx.defaultTimeout ?? 30000);

    const fullContext: ToolContext = {
      skipPermission: ctx?.skipPermission ?? this.defaultCtx.skipPermission ?? false,
      cwd: ctx?.cwd ?? this.defaultCtx.cwd ?? process.cwd(),
      defaultTimeout: effectiveTimeout,
      sideEffect: this.toolSideEffects.get(name) ?? true,
      confirmCallback: this._confirmCallback,
      outputHandler: this._outputHandler,
    };

    try {
      // Infinity means never timeout — skip Promise.race entirely
      if (effectiveTimeout === Infinity) {
        return await plugin.execute(name, args, fullContext);
      }

      const timer: { ref: NodeJS.Timeout | null } = { ref: null };
      try {
        return await Promise.race([
          plugin.execute(name, args, fullContext),
          new Promise<ToolResponse>((_, reject) => {
            timer.ref = setTimeout(
              () => reject(new Error(`Tool execution timed out after ${effectiveTimeout}ms`)),
              effectiveTimeout,
            );
          }),
        ]);
      } finally {
        if (timer.ref) clearTimeout(timer.ref);
      }
    } catch (error) {
      return {
        status: 'error',
        message: `工具 "${name}" 执行超时或失败：${error instanceof Error ? error.message : String(error)}。可尝试增加 defaultTimeout 或检查插件是否正常工作。`,
      };
    }
  }

  /**
   * Chain: call each plugin's transform hook passing previous result.
   */
  private execPipe<T>(getHook: (p: NanoPlugin) => ((v: T) => T) | undefined, initial: T, label: string): T {
    let v = initial;
    for (const p of this.plugins.values()) {
      const fn = getHook(p);
      if (!fn) continue;
      try { v = fn(v); }
      catch (err) { logManager.error('plugin', `${label} failed for "${p.name}":`, err); }
    }
    return v;
  }

  /**
   * Broadcast: call each plugin's void hook with args.
   */
  private execBroadcast(getHook: (p: NanoPlugin) => ((...args: any[]) => void) | undefined, label: string, ...args: any[]): void {
    for (const p of this.plugins.values()) {
      const fn = getHook(p);
      if (!fn) continue;
      try { fn(...args); }
      catch (err) { logManager.error('plugin', `${label} failed for "${p.name}":`, err); }
    }
  }

  execSystemPrompt(prompt: string): string {
    return this.execPipe(p => p.onSystemPrompt, prompt, 'onSystemPrompt');
  }

  execBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
    return this.execPipe(p => p.onBeforeRequest, messages, 'onBeforeRequest');
  }

  execAfterRequest(response: LLMResponse, rawMeta?: Record<string, unknown>): void {
    this.execBroadcast(p => p.onAfterRequest, 'onAfterRequest', response, rawMeta);
  }

  collectExtraParams(): Record<string, unknown> {
    let params: Record<string, unknown> = {};
    for (const p of this.plugins.values()) {
      const fn = p.onExtraParams;
      if (!fn) continue;
      try {
        const result = fn();
        if (result) params = { ...params, ...result };
      } catch (err) {
        logManager.error('plugin', ` onExtraParams failed for "${p.name}":`, err);
      }
    }
    return params;
  }

  execBeforeToolCall(toolCall: ToolCall): ToolCall | null {
    let current: ToolCall | null = toolCall;
    for (const p of this.plugins.values()) {
      const fn = p.onBeforeToolCall;
      if (!fn || !current) continue;
      try {
        current = fn(current);
      } catch (err) {
        logManager.error('plugin', ` onBeforeToolCall failed for "${p.name}":`, err);
        continue;
      }
      if (current === null) return null;
    }
    return current;
  }

  execAfterToolCall(result: ToolResponse): ToolResponse {
    return this.execPipe(p => p.onAfterToolCall, result, 'onAfterToolCall');
  }

  async execAgentReady(ctx: AgentReadyContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try { await plugin.onAgentReady?.(ctx); }
      catch (err) { logManager.error('plugin', `onAgentReady failed for "${plugin.name}":`, err); }
    }
  }

  async execSessionRestore(ctx: SessionRestoreContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try { await plugin.onSessionRestore?.(ctx); }
      catch (err) { logManager.error('plugin', `onSessionRestore failed for "${plugin.name}":`, err); }
    }
  }

  async execOnAgentExit(agentName: string): Promise<void> {
    const ctx: AgentExitContext = { agentName };
    for (const plugin of this.plugins.values()) {
      try { await plugin.onAgentExit?.(ctx); }
      catch (err) { logManager.error('plugin', `onAgentExit failed for "${plugin.name}":`, err); }
    }
  }

  async execBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onBeforeAgentInput) {
        try {
          const result = await plugin.onBeforeAgentInput(input);
          if (result?.handled) return result;
        } catch (err) {
          logManager.error('plugin', ` onBeforeAgentInput failed for "${plugin.name}":`, err);
        }
      }
    }
    // 以 / 或 ! 开头但无插件处理 → 返回错误提示
    const trimmed = input.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('!')) {
      return { handled: true, skipAgent: true, message: `未知命令：${trimmed.split(/\s+/)[0]}` };
    }
    return null;
  }

  /**
   * Return a snapshot of every registered plugin and its tools.
   */
  listPlugins(): Array<{ name: string; description?: string; version?: string; tools: ToolDefinition[] }> {
    const result: ReturnType<PluginRegistry['listPlugins']> = [];
    for (const [name, plugin] of this.plugins) {
      result.push({
        name,
        description: plugin.description,
        version: plugin.version,
        tools: plugin.getTools(),
      });
    }
    return result;
  }

  setPluginConfig(name: string, config: Record<string, any>): void {
    this.configs.set(name, config);
  }

  getPluginConfig(name: string): Record<string, any> {
    return this.configs.get(name) ?? {};
  }

}

// ── Builtin plugin loaders ──

const BUILTIN_LOADERS: Record<string, (settings?: Record<string, any>) => Promise<NanoPlugin>> = {
  fs: async () => (await import('#src/plugins/tools/fs.js')).fsPlugin,
  command: async () => (await import('#src/plugins/tools/command.js')).commandPlugin,
  memory: async (s) => (await import('#src/plugins/tools/memory.js')).createMemoryPlugin(s || {}),
  'token-budget': async (s) => (await import('#src/plugins/token-budget/index.js')).createTokenBudgetPlugin(s || {}),
  skills: async (s) => (await import('#src/plugins/skills/index.js')).createSkillsPlugin(s?.llmClient, s?.displayMgr, s?.agentManager, { disabled: s?.disabled, disableSkillTool: s?.disableSkillTool }),
  'file-search': async () => (await import('#src/plugins/tools/search.js')).searchPlugin,
  web: async () => (await import('#src/plugins/tools/web.js')).webPlugin,
  'model-registry': async (s) => (await import('#src/plugins/model-registry/index.js')).createModelRegistryPlugin(s || {}),
  // ── Feature plugins (loaded via registerBuiltinPlugin) ──
  coordinator: async (s) => (await import('#src/plugins/coordinator/coordinator.js')).createAgentCoordinatorPlugin(s?.llmClient, s?.displayMgr, s?.agentManager),
  commands: async (s) => (await import('#src/plugins/commands/index.js')).createCommandsPlugin(s?.displayMgr),
  'skills-slash': async (s) => (await import('#src/plugins/commands/skills-slash.js')).createSkillsSlashPlugin(s?.llmClient, s?.displayMgr, s?.agentManager),
  'agent-slash': async () => (await import('#src/plugins/commands/agent-slash.js')).createAgentSlashPlugin(),
  bang: async (s) => (await import('#src/plugins/commands/bang.js')).createBangPlugin(s?.displayMgr),
  'task-plan': async () => (await import('#src/plugins/tools/task-plan.js')).taskPlanPlugin,
  'npm-loader': async () => (await import('#src/plugins/npm-loader.js')).npmLoaderPlugin,
  'ask-user-question': async () => (await import('#src/plugins/tools/ask-user-question.js')).askUserQuestionPlugin,
  'mcp-loader': async (s) => (await import('#src/plugins/mcp/adapter.js')).createMcpLoaderPlugin(s?.config, s?.debug),
  'notify-manager': async (s) => (await import('#src/plugins/notify-manager.js')).createNotifyManagerPlugin(s || {}),
};

/**
 * 系统插件默认列表 — 自动注册且受保护（CLI enable/disable 不可操作）。
 * 用户可在 YAML 配置中通过 system_plugins 覆盖此列表。
 * 新增内置工具时：在此列表加一行即可（无需修改 config.ts）。
 */
export const DEFAULT_SYSTEM_PLUGINS: readonly string[] = [
  'fs',
  'command',
  'memory',
  'token-budget',
  'file-search',
  'mcp-loader',
];

/**
 * 默认 feature 插件列表 — 在系统插件之后注册，可接收 settings 传入运行时依赖。
 * 用户可在 YAML 配置中通过 plugins.<name>.enabled = false 禁用。
 */
export const DEFAULT_FEATURE_PLUGINS: readonly string[] = [
  'skills',
  'coordinator',
  'commands',
  'skills-slash',
  'agent-slash',
  'bang',
  'task-plan',
  'ask-user-question',
  'npm-loader',
];

/**
 * 按内置名注册一个插件。
 * 新增内置工具：在 BUILTIN_LOADERS + DEFAULT_SYSTEM_PLUGINS 各加一行即可。
 * @returns true 表示已注册，false 表示名称未识别（调用方应忽略或警告）。
 */
export async function registerBuiltinPlugin(
  registry: PluginRegistry,
  name: string,
  settings?: Record<string, any>,
): Promise<boolean> {
  const loader = BUILTIN_LOADERS[name];
  if (!loader) return false;

  if (settings) registry.setPluginConfig(name, settings);
  await registry.register(await loader(settings));
  return true;
}
