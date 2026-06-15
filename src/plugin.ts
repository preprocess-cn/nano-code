import { ToolDefinition, ToolResponse, ToolContext, formatToolResponse } from './contract.js';
import { ChatMessage } from './llm.js';

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
  onAfterRequest?(response: LLMResponse): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;
}

// ── Plugin registry ──

export class PluginRegistry {
  private plugins: Map<string, NanoPlugin> = new Map();
  private toolIndex: Map<string, string> = new Map();
  private configs: Map<string, Record<string, any>> = new Map();
  private defaultCtx: Partial<ToolContext> = {};

  setDefaultContext(ctx: Partial<ToolContext>): void {
    this.defaultCtx = ctx;
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
  // search(query: string): Promise<PluginManifest[]>;
  // install(name: string): Promise<void>;
  // uninstall(name: string): Promise<void>;
  // listInstalled(): PluginManifest[];
}
