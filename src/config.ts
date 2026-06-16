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
  sideEffect?: boolean;   // false = 无后效性（只读），无需用户确认；默认 true
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
    const obj = parsed as Record<string, unknown>;

    // Schema validation catches typos and type errors early
    const warnings = validateConfigObject(obj);
    for (const w of warnings) {
      console.warn(`[config] Warning: ${filePath} — ${w.path}: ${w.message}`);
    }

    return obj;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn(`[config] Warning: Invalid JSON in ${filePath}, skipping.`);
    } else {
      console.warn(`[config] Warning: Could not read ${filePath}: ${err}`);
    }
    return null;
  }
}

// ── Schema validation ──

/** A single validation warning about a config field. */
export interface ConfigValidationWarning {
  path: string;
  message: string;
}

const KNOWN_CORE_KEYS = new Set(['model', 'temperature', 'maxTokens', 'defaultTimeout']);
const KNOWN_PLUGIN_ENTRY_KEYS = new Set([
  'type', 'enabled', 'sideEffect', 'settings',
  'transport', 'command', 'args', 'url', 'env', 'initTimeout',
]);
const VALID_PLUGIN_TYPES = new Set(['builtin', 'mcp', 'npm']);
const VALID_TRANSPORT_TYPES = new Set(['stdio', 'http']);

function validateType(val: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  return typeof val === type;
}

/**
 * Deep-schema-validate a raw config object (the parsed JSON from a config file).
 * Returns a list of warnings for unknown keys, type mismatches, and out-of-range values.
 */
export function validateConfigObject(raw: Record<string, unknown>): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];
  const TOP_KEYS = new Set(['core', 'plugins', 'agent']);

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) {
      warnings.push({ path: key, message: `未知的配置项 "${key}"` });
    }
  }

  // core.*
  if (isNonEmptyObject(raw.core)) {
    for (const key of Object.keys(raw.core)) {
      if (!KNOWN_CORE_KEYS.has(key)) {
        warnings.push({ path: `core.${key}`, message: `未知的 core 配置项 "${key}"` });
      }
    }
    if ('model' in raw.core && !validateType(raw.core.model, 'string')) {
      warnings.push({ path: 'core.model', message: 'model 必须为字符串' });
    }
    if ('temperature' in raw.core) {
      if (!validateType(raw.core.temperature, 'number')) {
        warnings.push({ path: 'core.temperature', message: 'temperature 必须为数字' });
      } else if (raw.core.temperature < 0 || raw.core.temperature > 2) {
        warnings.push({ path: 'core.temperature', message: '温度值应在 0-2 之间' });
      }
    }
    if ('maxTokens' in raw.core && (typeof raw.core.maxTokens !== 'number' || raw.core.maxTokens <= 0)) {
      warnings.push({ path: 'core.maxTokens', message: 'maxTokens 必须为正数' });
    }
    if ('defaultTimeout' in raw.core && (typeof raw.core.defaultTimeout !== 'number' || raw.core.defaultTimeout <= 0)) {
      warnings.push({ path: 'core.defaultTimeout', message: 'defaultTimeout 必须为正数' });
    }
  }

  // agent.*
  if (isNonEmptyObject(raw.agent)) {
    for (const key of Object.keys(raw.agent)) {
      if (key !== 'role' && key !== 'greeting') {
        warnings.push({ path: `agent.${key}`, message: `未知的 agent 配置项 "${key}"` });
      }
    }
    if ('role' in raw.agent && !validateType(raw.agent.role, 'string')) {
      warnings.push({ path: 'agent.role', message: 'role 必须为字符串' });
    }
    if ('greeting' in raw.agent && !validateType(raw.agent.greeting, 'string')) {
      warnings.push({ path: 'agent.greeting', message: 'greeting 必须为字符串' });
    }
  }

  // plugins.*
  if (isNonEmptyObject(raw.plugins)) {
    for (const [name, pluginConfig] of Object.entries(raw.plugins)) {
      if (!isNonEmptyObject(pluginConfig)) {
        warnings.push({ path: `plugins.${name}`, message: '插件配置必须为对象' });
        continue;
      }

      const entry = pluginConfig as Record<string, unknown>;

      for (const key of Object.keys(entry)) {
        if (!KNOWN_PLUGIN_ENTRY_KEYS.has(key)) {
          warnings.push({ path: `plugins.${name}.${key}`, message: `未知的插件配置项 "${key}"` });
        }
      }

      // type validity
      if (entry.type !== undefined && !VALID_PLUGIN_TYPES.has(entry.type as string)) {
        warnings.push({
          path: `plugins.${name}.type`,
          message: `未知的插件类型 "${entry.type}"，应为 builtin、mcp 或 npm`,
        });
      }

      // enabled must be boolean
      if (entry.enabled !== undefined && !validateType(entry.enabled, 'boolean')) {
        warnings.push({ path: `plugins.${name}.enabled`, message: 'enabled 必须为布尔值' });
      }

      // sideEffect must be boolean
      if (entry.sideEffect !== undefined && !validateType(entry.sideEffect, 'boolean')) {
        warnings.push({ path: `plugins.${name}.sideEffect`, message: 'sideEffect 必须为布尔值' });
      }

      // transport validity
      if (entry.transport !== undefined && !VALID_TRANSPORT_TYPES.has(entry.transport as string)) {
        warnings.push({
          path: `plugins.${name}.transport`,
          message: `未知的传输类型 "${entry.transport}"，应为 stdio 或 http`,
        });
      }

      // initTimeout must be positive
      if (entry.initTimeout !== undefined && (typeof entry.initTimeout !== 'number' || entry.initTimeout <= 0)) {
        warnings.push({ path: `plugins.${name}.initTimeout`, message: 'initTimeout 必须为正数' });
      }

      // MCP required-field hints
      const pluginType = entry.type as string | undefined;
      if (pluginType === 'mcp' || pluginType === undefined) {
        if (entry.transport === 'stdio' && !entry.command) {
          warnings.push({ path: `plugins.${name}.command`, message: 'stdio 类型的 MCP 插件需要指定 command' });
        }
        if (entry.transport === 'http' && !entry.url) {
          warnings.push({ path: `plugins.${name}.url`, message: 'http 类型的 MCP 插件需要指定 url' });
        }
      }
    }
  }

  return warnings;
}

// ── Merge helpers ──

type FieldType = 'string' | 'number' | 'boolean';

/** Pick known-typed fields from an override object, falling back to `base`. */
function mergeTypedFields<T extends Record<string, any>>(
  base: T,
  override: unknown,
  schema: Record<keyof T, FieldType>,
): T {
  if (!isNonEmptyObject(override)) return { ...base };
  const raw = override as Record<string, unknown>;
  const result = { ...base };
  for (const key of Object.keys(schema) as (keyof T)[]) {
    const val = raw[key as string];
    if (typeof val === schema[key]) result[key] = val;
  }
  return result;
}

function isNonEmptyObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function mergeCoreValues(
  base: NanoConfig['core'],
  override: unknown,
): NanoConfig['core'] {
  return mergeTypedFields(base, override, {
    model: 'string',
    temperature: 'number',
    maxTokens: 'number',
    defaultTimeout: 'number',
  });
}

function mergeAgentConfig(
  base: AgentConfig | undefined,
  override: unknown,
): AgentConfig | undefined {
  if (!isNonEmptyObject(override)) return base;
  const o = override as Record<string, unknown>;
  const role = typeof o.role === 'string' ? o.role : base?.role;
  const greeting = typeof o.greeting === 'string' ? o.greeting : base?.greeting;
  return (role !== undefined || greeting !== undefined) ? { role, greeting } : undefined;
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
