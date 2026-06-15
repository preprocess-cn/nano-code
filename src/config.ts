import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Typed config interface ──

export interface AgentConfig {
  role?: string;     // agent 角色描述，用于系统提示（如"终端 AI 编程助手"）
  greeting?: string; // 启动时向用户显示的能力提示
}

export interface PluginConfigEntry {
  type?: 'builtin' | 'mcp' | 'npm';
  enabled?: boolean;
  settings?: Record<string, any>;
  // MCP-specific
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  initTimeout?: number;   // MCP server init timeout in ms (default: 10000)
}

export interface NanoConfig {
  core: {
    model: string;
    temperature: number;
    maxTokens: number;
    defaultTimeout: number;
  };
  agent?: AgentConfig;
  plugins: {
    [pluginName: string]: PluginConfigEntry;
  };
}

// ── Defaults ──

const DEFAULT_CONFIG: NanoConfig = {
  core: {
    model: 'gpt-4o',
    temperature: 0,
    maxTokens: 4096,
    defaultTimeout: 120000,
  },
  plugins: {},
};

// ── Cache ──

let cachedConfig: NanoConfig | null = null;

// ── Config file paths ──

function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.nano-code', 'config.json');
}

function getProjectConfigPath(): string {
  return path.join(process.cwd(), '.nano-code.json');
}

// ── Single file loading ──

/**
 * Attempt to load a config file from disk. Returns the parsed object on
 * success, logs a warning and returns null on failure.
 */
function tryLoadConfigFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn(`[config] Warning: ${filePath} must contain a JSON object, skipping.`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn(`[config] Warning: Invalid JSON in ${filePath}, skipping.`);
    } else {
      console.warn(`[config] Warning: Could not read ${filePath}: ${err}`);
    }
    return null;
  }
}

// ── Merge helpers ──

function isNonEmptyObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function mergeCoreValues(
  base: NanoConfig['core'],
  override: unknown,
): NanoConfig['core'] {
  if (!isNonEmptyObject(override)) {
    return { ...base };
  }
  return {
    model: typeof override.model === 'string' ? override.model : base.model,
    temperature: typeof override.temperature === 'number' ? override.temperature : base.temperature,
    maxTokens: typeof override.maxTokens === 'number' ? override.maxTokens : base.maxTokens,
    defaultTimeout:
      typeof override.defaultTimeout === 'number' ? override.defaultTimeout : base.defaultTimeout,
  };
}

function mergeAgentConfig(
  base: AgentConfig | undefined,
  override: unknown,
): AgentConfig | undefined {
  if (!isNonEmptyObject(override)) return base;
  const o = override as Record<string, unknown>;
  const result: AgentConfig = {};
  if (typeof o.role === 'string') result.role = o.role;
  else if (base?.role) result.role = base.role;
  if (typeof o.greeting === 'string') result.greeting = o.greeting;
  else if (base?.greeting) result.greeting = base.greeting;
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergePluginEntries(
  base: NanoConfig['plugins'],
  override: unknown,
): NanoConfig['plugins'] {
  const result: NanoConfig['plugins'] = { ...base };

  if (!isNonEmptyObject(override)) {
    return result;
  }

  for (const [name, rawConfig] of Object.entries(override)) {
    if (!isNonEmptyObject(rawConfig)) {
      console.warn(`[config] Warning: Plugin "${name}" has invalid config (must be an object), skipping.`);
      continue;
    }

    const existing = result[name] ?? {};
    result[name] = {
      ...existing,
      ...rawConfig,
      // Deep-merge the nested `settings` so project-level key additions
      // don't wipe out global-level ones.
      settings: {
        ...(isNonEmptyObject(existing.settings) ? existing.settings : {}),
        ...(isNonEmptyObject(rawConfig.settings) ? rawConfig.settings : {}),
      },
    } as PluginConfigEntry;
  }

  return result;
}

/**
 * Merge global and project configs into a single NanoConfig.
 * Project values take precedence over global values.
 */
function mergeConfigs(
  global: Record<string, unknown> | null,
  project: Record<string, unknown> | null,
): NanoConfig {
  const result: NanoConfig = {
    core: { ...DEFAULT_CONFIG.core },
    plugins: { ...DEFAULT_CONFIG.plugins },
  };

  const sources = [
    { label: 'global', data: global },
    { label: 'project', data: project },
  ];

  for (const { label, data } of sources) {
    if (!data) continue;

    // Warn about unknown top-level keys
    for (const key of Object.keys(data)) {
      if (key !== 'core' && key !== 'plugins' && key !== 'agent') {
        console.warn(`[config] Warning: Unknown config key "${key}" in ${label} config, ignoring.`);
      }
    }

    // Merge core
    if ('core' in data) {
      result.core = mergeCoreValues(result.core, data.core);
    }

    // Merge agent (project overrides global, field by field)
    if ('agent' in data) {
      result.agent = mergeAgentConfig(result.agent, data.agent);
    }

    // Merge plugins
    if ('plugins' in data) {
      result.plugins = mergePluginEntries(result.plugins, data.plugins);
    }
  }

  return result;
}

// ── Exported API ──

/**
 * Load and merge config from global and project-level config files.
 *
 * - Global:  `~/.nano-code/config.json`
 * - Project: `$CWD/.nano-code.json`  (overrides global)
 *
 * The result is cached after the first call so repeated loads are
 * free.  Call `resetConfigCache()` to force a fresh read from disk.
 */
export function loadConfig(): NanoConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath();

  cachedConfig = mergeConfigs(
    tryLoadConfigFile(globalPath),
    tryLoadConfigFile(projectPath),
  );

  return cachedConfig;
}

/**
 * Return the isolated `settings` portion of a plugin's config entry,
 * or an empty object if the plugin has no configuration.
 */
export function getPluginConfig(
  config: NanoConfig,
  pluginName: string,
): Record<string, any> {
  return config.plugins[pluginName]?.settings ?? {};
}

/**
 * Reset the in-memory config cache so the next call to `loadConfig()`
 * re-reads both config files from disk.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/** @internal exported for testing */
export function _mergeConfigs(
  global: Record<string, unknown> | null,
  project: Record<string, unknown> | null,
): NanoConfig {
  return mergeConfigs(global, project);
}
