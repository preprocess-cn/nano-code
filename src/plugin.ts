import { ToolDefinition, ToolResponse, ToolContext, formatToolResponse } from './contract.js';
import { ChatMessage } from './llm.js';

// ── Companion types for hooks ──

export interface LLMResponse {
  text: string | null;
  toolCalls?: ToolCall[];
  stopReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
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
  onAfterRequest?(response: LLMResponse): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;
}

// ── Plugin registry ──

export class PluginRegistry {
  private plugins: Map<string, NanoPlugin> = new Map();
  private toolIndex: Map<string, string> = new Map();
  private toolSideEffects: Map<string, boolean> = new Map();
  private configs: Map<string, Record<string, any>> = new Map();
  private defaultCtx: Partial<ToolContext> = {};
  private agentName: string = 'main';

  setDefaultContext(ctx: Partial<ToolContext>): void {
    this.defaultCtx = ctx;
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

  async execute(name: string, args: any, ctx?: Partial<ToolContext>): Promise<string> {
    const pluginName = this.toolIndex.get(name);
    if (!pluginName) {
      return formatToolResponse({
        status: 'error',
        message: `Unknown tool: ${name}`,
      });
    }

    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return formatToolResponse({
        status: 'error',
        message: `Plugin not found: ${pluginName}`,
      });
    }

    const fullContext: ToolContext = {
      skipPermission: ctx?.skipPermission ?? this.defaultCtx.skipPermission ?? false,
      cwd: ctx?.cwd ?? this.defaultCtx.cwd ?? process.cwd(),
      defaultTimeout: ctx?.defaultTimeout ?? this.defaultCtx.defaultTimeout ?? 30000,
      sideEffect: this.toolSideEffects.get(name) ?? true,
    };

    try {
      const timer: { ref: NodeJS.Timeout | null } = { ref: null };
      const result = await Promise.race([
        plugin.execute(name, args, fullContext),
        new Promise<ToolResponse>((_, reject) => {
          timer.ref = setTimeout(
            () => reject(new Error(`Tool execution timed out after ${fullContext.defaultTimeout}ms`)),
            fullContext.defaultTimeout,
          );
        }),
      ]);
      if (timer.ref) clearTimeout(timer.ref);
      return formatToolResponse(result);
    } catch (error) {
      return formatToolResponse({
        status: 'error',
        message: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  execSystemPrompt(prompt: string): string {
    let result = prompt;
    for (const plugin of this.plugins.values()) {
      if (plugin.onSystemPrompt) {
        try {
          result = plugin.onSystemPrompt(result);
        } catch (err) {
          console.error(`[plugin] onSystemPrompt failed for "${plugin.name}":`, err);
        }
      }
    }
    return result;
  }

  execBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
    let result = messages;
    for (const plugin of this.plugins.values()) {
      if (plugin.onBeforeRequest) {
        try {
          result = plugin.onBeforeRequest(result);
        } catch (err) {
          console.error(`[plugin] onBeforeRequest failed for "${plugin.name}":`, err);
        }
      }
    }
    return result;
  }

  execAfterRequest(response: LLMResponse): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.onAfterRequest) {
        try {
          plugin.onAfterRequest(response);
        } catch (err) {
          console.error(`[plugin] onAfterRequest failed for "${plugin.name}":`, err);
        }
      }
    }
  }

  execBeforeToolCall(toolCall: ToolCall): ToolCall | null {
    let current: ToolCall | null = toolCall;
    for (const plugin of this.plugins.values()) {
      if (plugin.onBeforeToolCall && current) {
        try {
          current = plugin.onBeforeToolCall(current);
        } catch (err) {
          console.error(`[plugin] onBeforeToolCall failed for "${plugin.name}":`, err);
          continue;
        }
        if (current === null) {
          return null;
        }
      }
    }
    return current;
  }

  execAfterToolCall(result: ToolResponse): ToolResponse {
    let current = result;
    for (const plugin of this.plugins.values()) {
      if (plugin.onAfterToolCall) {
        try {
          current = plugin.onAfterToolCall(current);
        } catch (err) {
          console.error(`[plugin] onAfterToolCall failed for "${plugin.name}":`, err);
        }
      }
    }
    return current;
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

const BUILTIN_LOADERS: Record<string, () => Promise<NanoPlugin>> = {
  fs: () => import('./plugins/tools/fs.js').then(m => m.fsPlugin),
  command: () => import('./plugins/tools/command.js').then(m => m.commandPlugin),
};

/**
 * 按内置名注册一个插件。处理 fs / command / memory / token-budget。
 * @returns true 表示已注册，false 表示名称未识别（调用方应忽略或警告）。
 */
export async function registerBuiltinPlugin(
  registry: PluginRegistry,
  name: string,
  settings?: Record<string, any>,
): Promise<boolean> {
  if (settings) registry.setPluginConfig(name, settings);

  const loader = BUILTIN_LOADERS[name];
  if (loader) {
    await registry.register(await loader());
    return true;
  }

  switch (name) {
    case 'memory': {
      const { createMemoryPlugin } = await import('./plugins/tools/memory.js');
      await registry.register(createMemoryPlugin(settings || {}));
      return true;
    }
    case 'token-budget': {
      const { createTokenBudgetPlugin } = await import('./plugins/token-budget.js');
      await registry.register(createTokenBudgetPlugin(settings || {}));
      return true;
    }
    default:
      return false;
  }
}
