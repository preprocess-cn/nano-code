import { ToolDefinition, ToolResponse, ToolContext, CommandInterceptResult, type PermissionConfirmRequest, type PermissionConfirmResponse, type CommandOutputHandler } from './contract.js';
import { ChatMessage } from './llm.js';
import { IStore } from './store.js';
import { InMemoryStore } from './plugins/store/in-memory.js';

// ── Companion types for hooks ──

export interface LLMResponse {
  text: string | null;
  toolCalls?: ToolCall[];
  stopReason?: string;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

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
}

// ── Plugin registry ──

export class PluginRegistry {
  private plugins: Map<string, NanoPlugin> = new Map();
  private toolIndex: Map<string, string> = new Map();
  private toolSideEffects: Map<string, boolean> = new Map();
  private configs: Map<string, Record<string, any>> = new Map();
  private defaultCtx: Partial<ToolContext> = {};
  private agentName: string = 'main';
  private _confirmCallback?: (req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>;
  private _outputHandler?: CommandOutputHandler;

  /** 插件间共享状态通道。核心只做透传，不知晓任何 key 的业务含义 */
  store: IStore = new InMemoryStore();

  setDefaultContext(ctx: Partial<ToolContext>): void {
    this.defaultCtx = ctx;
  }

  setConfirmCallback(cb: (req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>): void {
    this._confirmCallback = cb;
  }

  getConfirmCallback(): ((req: PermissionConfirmRequest) => Promise<PermissionConfirmResponse>) | undefined {
    return this._confirmCallback;
  }

  setOutputHandler(handler: CommandOutputHandler): void {
    this._outputHandler = handler;
  }

  setAgentName(name: string): void {
    this.agentName = name;
  }

  getAgentName(): string {
    return this.agentName;
  }

  async register(plugin: NanoPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[plugin] Warning: Plugin "${plugin.name}" is already registered, overwriting.`);
      await this.unregister(plugin.name);
    }

    this.plugins.set(plugin.name, plugin);
    for (const tool of plugin.getTools()) {
      if (this.toolIndex.has(tool.function.name)) {
        console.warn(`[plugin] Warning: Tool "${tool.function.name}" already registered by plugin "${this.toolIndex.get(tool.function.name)}", overwritten by "${plugin.name}".`);
      }
      this.toolIndex.set(tool.function.name, plugin.name);
      this.toolSideEffects.set(tool.function.name, tool.function.sideEffect ?? true);
    }

    try {
      if (plugin.onInit) {
        await plugin.onInit(this);
      }
    } catch (err) {
      console.error(`[plugin] onInit failed for "${plugin.name}":`, err);
    }
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    try {
      if (plugin.onDestroy) {
        await plugin.onDestroy();
      }
    } catch (err) {
      console.error(`[plugin] onDestroy failed for "${name}":`, err);
    }

    for (const [toolName, pluginName] of this.toolIndex.entries()) {
      if (pluginName === name) {
        this.toolIndex.delete(toolName);
        this.toolSideEffects.delete(toolName);
      }
    }
    this.plugins.delete(name);
    this.configs.delete(name);
  }

  getAllSchemas(): ToolDefinition[] {
    const schemas: ToolDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      schemas.push(...plugin.getTools());
    }
    return schemas;
  }

  async execute(name: string, args: any, ctx?: Partial<ToolContext>): Promise<ToolResponse> {
    const pluginName = this.toolIndex.get(name);
    if (!pluginName) {
      return {
        status: 'error',
        message: `Unknown tool: ${name}`,
      };
    }

    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return {
        status: 'error',
        message: `Plugin not found: ${pluginName}`,
      };
    }

    const fullContext: ToolContext = {
      skipPermission: ctx?.skipPermission ?? this.defaultCtx.skipPermission ?? false,
      cwd: ctx?.cwd ?? this.defaultCtx.cwd ?? process.cwd(),
      defaultTimeout: ctx?.defaultTimeout ?? this.defaultCtx.defaultTimeout ?? 30000,
      sideEffect: this.toolSideEffects.get(name) ?? true,
      confirmCallback: this._confirmCallback,
      outputHandler: this._outputHandler,
    };

    try {
      const timer: { ref: NodeJS.Timeout | null } = { ref: null };
      try {
        return await Promise.race([
          plugin.execute(name, args, fullContext),
          new Promise<ToolResponse>((_, reject) => {
            timer.ref = setTimeout(
              () => reject(new Error(`Tool execution timed out after ${fullContext.defaultTimeout}ms`)),
              fullContext.defaultTimeout,
            );
          }),
        ]);
      } finally {
        if (timer.ref) clearTimeout(timer.ref);
      }
    } catch (error) {
      return {
        status: 'error',
        message: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Chain: call each plugin's transform hook passing previous result.
   * Skips plugins that don't implement the hook or throw.
   */
  private execPipe<T>(getHook: (p: NanoPlugin) => ((v: T) => T) | undefined, initial: T, label: string): T {
    let v = initial;
    for (const p of this.plugins.values()) {
      const fn = getHook(p);
      if (!fn) continue;
      try { v = fn(v); }
      catch (err) { console.error(`[plugin] ${label} failed for "${p.name}":`, err); }
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
      catch (err) { console.error(`[plugin] ${label} failed for "${p.name}":`, err); }
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
        console.error(`[plugin] onExtraParams failed for "${p.name}":`, err);
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
        console.error(`[plugin] onBeforeToolCall failed for "${p.name}":`, err);
        continue;
      }
      if (current === null) return null;
    }
    return current;
  }

  execAfterToolCall(result: ToolResponse): ToolResponse {
    return this.execPipe(p => p.onAfterToolCall, result, 'onAfterToolCall');
  }

  /**
   * 遍历所有实现了 onBeforeAgentInput 的插件，返回第一个处理结果。
   * 无插件处理该输入时返回 null（正常交由 agent 处理）。
   */
  async execBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onBeforeAgentInput) {
        try {
          const result = await plugin.onBeforeAgentInput(input);
          if (result?.handled) return result;
        } catch (err) {
          console.error(`[plugin] onBeforeAgentInput failed for "${plugin.name}":`, err);
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

  // ─── Reserved: plugin marketplace API stubs ───
}

// ── Builtin plugin loaders ──

const BUILTIN_LOADERS: Record<string, (settings?: Record<string, any>) => Promise<NanoPlugin>> = {
  fs: async () => (await import('./plugins/tools/fs.js')).fsPlugin,
  command: async () => (await import('./plugins/tools/command.js')).commandPlugin,
  memory: async (s) => (await import('./plugins/tools/memory.js')).createMemoryPlugin(s || {}),
  'token-budget': async (s) => (await import('./plugins/token-budget/index.js')).createTokenBudgetPlugin(s || {}),
  skills: async () => (await import('./plugins/skills/index.js')).createSkillsPlugin(),
  search: async () => (await import('./plugins/tools/search.js')).searchPlugin,
  web: async () => (await import('./plugins/tools/web.js')).webPlugin,
};

/**
 * 按内置名注册一个插件。处理 fs / command / memory / token-budget / skills / search。
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
