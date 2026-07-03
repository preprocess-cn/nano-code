import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';
import { ModelEntry, resolveEnvVar } from '#src/core/llm.js';
import { SK } from '#src/core/store-keys.js';

export interface ModelRegistrySettings {
  models?: ModelEntry[];
}

export function createModelRegistryPlugin(settings?: ModelRegistrySettings): NanoPlugin {
  return {
    name: 'model-registry',
    description: 'LLM provider registry — select model/credentials per request',

    getTools(): ToolDefinition[] {
      return [];
    },

    async execute(_name: string, _args: any, _ctx: ToolContext): Promise<ToolResponse> {
      return { status: 'error', message: 'model-registry provides no tools' };
    },

    async onInit(registry: PluginRegistry): Promise<void> {
      const config = registry.getPluginConfig('model-registry') as ModelRegistrySettings | undefined;
      const models = config?.models ?? settings?.models ?? [];
      if (models.length === 0) return;

      // Resolve $ENV_VAR references for all models
      const resolved: ModelEntry[] = models.map(raw => ({
        provider: raw.provider,
        model: raw.model,
        apiKey: raw.apiKey ? resolveEnvVar(raw.apiKey) : undefined,
        baseURL: raw.baseURL ? resolveEnvVar(raw.baseURL) : undefined,
        temperature: raw.temperature,
        maxTokens: raw.maxTokens,
        extraParams: raw.extraParams,
      }));

      // Store the full resolved list (for /model command and --model CLI)
      registry.store.set(SK.ModelRegistryModels, resolved);

      // Default to the first model
      registry.store.set(SK.ModelOverride, resolved[0]);
    },
  };
}
