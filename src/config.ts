import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

const CONFIG_TOP_KEYS = new Set(['core', 'plugins', 'agent', 'display']);

// ── Typed config interface ──

export interface AgentConfig {
  role?: string;     // agent 角色描述，用于系统提示（如"终端 AI 编程助手"）
  greeting?: string; // 启动时向用户显示的能力提示
}

export interface SystemPromptConfig {
  /** 有工具时的提示词模板，可用变量 {role} {tool_list} */
  withTools?: string;
  /** 无工具时的提示词模板，可用变量 {role} */
  noTools?: string;
  /** 项目级指令文件搜索优先级 */
  projectFiles?: string[];
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
  // npm-specific
  spec?: string;           // npm 包名或 import 路径
}

export interface NanoConfig {
  core: {
    model?: string;
    temperature?: number;
    maxTokens: number;
    defaultTimeout: number;
    apiKey?: string;
    baseURL?: string;
  };
  agent?: AgentConfig;
  plugins: {
    [pluginName: string]: PluginConfigEntry;
  };
  /** 系统白名单中的插件名列表，CLI enable/disable 不可操作。 */
  systemPlugins?: string[];
  /** 系统提示词配置（来自 YAML），prompt.ts 读取此字段拼接。 */
  systemPrompt?: SystemPromptConfig;
  /** 展示层配置。plugin 指定展示插件名（默认 "repl"），enabled=false 时必须有其它展示层代替。 */
  display?: {
    plugin?: string;
    enabled?: boolean;
  };
}

// ── Defaults ──

const DEFAULT_CONFIG: NanoConfig = {
  core: {
    maxTokens: 128000,
    defaultTimeout: 120000,
  },
  plugins: {},
};

// ── Default YAML template ──

const DEFAULT_YAML = `# nano-code 全局配置
# 首次启动时自动创建，编辑后重启生效。

# 系统插件白名单 — CLI enable/disable 不可操作，仅通过配置文件开启/关闭
system_plugins:
  - fs
  - command
  - memory
  - token-budget
  - skills

# 环境变量兜底（shell 和 .env 优先级更高）
env:
  OPENAI_API_KEY: ""
  OPENAI_BASE_URL: ""

# 系统提示词模板 — 可用变量 {role} {tool_list}
# 编辑后重启生效
system_prompt:
  with_tools: |
    你是一个名为 nano-code 的 {role}。你可以调用以下工具来完成工作：{tool_list}。

    【核心安全约束】如果人类用户拒绝了你的工具执行权限（返回状态为 rejected_by_user），这是最高级别的物理约束。
    你必须立刻停止该方向的尝试，在当前轮次中严禁再次生成任何工具调用（tool_calls），绝对不要换个参数或换个工具重试。
    请转为纯文本模式，向用户诚恳解释该操作的必要性，并主动提供其他不依赖该工具的非侵入式替代方案（例如提供手动指令或打印代码由用户自行复制）。

    请保持回答简洁专业。

  no_tools: |
    你是一个名为 nano-code 的 {role}。你可以帮助用户解决编程问题，提供代码示例和建议。如果回答涉及代码或命令，请直接输出文本，用户会自行复制使用。请保持回答简洁专业。

  # 项目级指令文件搜索优先级
  project_files:
    - AGENT.md
    - CLAUDE.md
    - AGENT.txt
    - CLAUDE.txt
`;

// ── Config file paths ──

function getGlobalYAMLConfigPath(): string {
  return path.join(os.homedir(), '.nano-code', 'config.yaml');
}

function getProjectConfigPath(): string {
  return path.join(process.cwd(), '.nano-code.yaml');
}

function getGlobalProfilePath(name: string): string {
  return path.join(os.homedir(), '.nano-code', 'profiles', `${name}.json`);
}

function getProjectProfilePath(name: string): string {
  return path.join(process.cwd(), '.nano-code', 'profiles', `${name}.json`);
}

/**
 * Load an agent profile configuration file.
 *
 * - If `name` is a file path (contains `/` or starts with `.`/`~`),
 *   loads it directly.
 * - Otherwise searches project dir first (`.nano-code/profiles/<name>.json`),
 *   then global (`~/.nano-code/profiles/<name>.json`).
 *
 * Returns `null` if not found.
 */
export function loadProfileConfig(name: string): Record<string, unknown> | null {
  if (!name) return null;

  // Direct file path: contains a path separator or starts with . / ~
  if (name.includes('/') || name.includes('\\') || name.startsWith('.') || name.startsWith('~')) {
    const resolved = name.startsWith('~')
      ? path.join(os.homedir(), name.slice(1))
      : path.resolve(process.cwd(), name);
    return tryLoadConfigFile(resolved);
  }

  // Plain name: search predefined directories
  const projectPath = getProjectProfilePath(name);
  const projectProfile = tryLoadConfigFile(projectPath);
  if (projectProfile) return projectProfile;

  const globalPath = getGlobalProfilePath(name);
  return tryLoadConfigFile(globalPath);
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

/**
 * 确保 ~/.nano-code/config.yaml 存在，不存在则创建默认模板。
 */
export function ensureDefaultYAML(): void {
  const yamlPath = getGlobalYAMLConfigPath();
  if (fs.existsSync(yamlPath)) return;
  const dir = path.dirname(yamlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(yamlPath, DEFAULT_YAML, 'utf-8');
}

/**
 * 加载 YAML 配置文件。不存在或解析失败时返回 null。
 */
function loadYAMLFromFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn(`[config] Warning: ${filePath} 必须包含一个对象，跳过。`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      console.warn(`[config] Warning: ${filePath} YAML 解析失败，跳过。`);
    } else {
      console.warn(`[config] Warning: 无法读取 ${filePath}: ${err}`);
    }
    return null;
  }
}

function loadYAMLConfig(): Record<string, unknown> | null {
  return loadYAMLFromFile(getGlobalYAMLConfigPath());
}

/**
 * 从 YAML 配置中读取 env 并写入 process.env（优先级最低，
 * 不覆盖已存在的环境变量和 .env 设置）。
 */
function applyYAMLEnv(yamlData: Record<string, unknown> | null): void {
  if (!yamlData) return;
  const env = yamlData.env;
  if (!env || typeof env !== 'object') return;
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key] && typeof value === 'string' && value) {
      process.env[key] = value;
    }
  }
}

// ── Schema validation ──

/** A single validation warning about a config field. */
export interface ConfigValidationWarning {
  path: string;
  message: string;
}

const KNOWN_CORE_KEYS = new Set(['model', 'temperature', 'maxTokens', 'defaultTimeout', 'apiKey', 'baseURL']);
const KNOWN_PLUGIN_ENTRY_KEYS = new Set([
  'type', 'enabled', 'sideEffect', 'settings',
  'transport', 'command', 'args', 'url', 'env', 'initTimeout',
  'spec',
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
  const DISPLAY_KEYS = new Set(['plugin', 'enabled']);

  for (const key of Object.keys(raw)) {
    if (!CONFIG_TOP_KEYS.has(key)) {
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
      const t = raw.core.temperature;
      if (typeof t !== 'number') {
        warnings.push({ path: 'core.temperature', message: 'temperature 必须为数字' });
      } else if (t < 0 || t > 2) {
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

      // npm required-field hints
      if (pluginType === 'npm' && !entry.spec) {
        warnings.push({ path: `plugins.${name}.spec`, message: 'npm 类型的插件需要指定 spec（npm 包名或 import 路径）' });
      }
    }
  }

  // display.*
  if (isNonEmptyObject(raw.display)) {
    const dsp = raw.display as Record<string, unknown>;
    for (const key of Object.keys(dsp)) {
      if (!DISPLAY_KEYS.has(key)) {
        warnings.push({ path: `display.${key}`, message: `未知的展示层配置项 "${key}"` });
      }
    }
    if ('plugin' in dsp && !validateType(dsp.plugin, 'string')) {
      warnings.push({ path: 'display.plugin', message: 'plugin 必须为字符串' });
    }
    if ('enabled' in dsp && !validateType(dsp.enabled, 'boolean')) {
      warnings.push({ path: 'display.enabled', message: 'enabled 必须为布尔值' });
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
    if (typeof val === schema[key]) result[key] = val as T[keyof T];
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
    apiKey: 'string',
    baseURL: 'string',
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
      if (!CONFIG_TOP_KEYS.has(key)) {
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

    // Merge display (shallow — project overrides global)
    if ('display' in data) {
      const override = isNonEmptyObject(data.display)
        ? data.display as Record<string, unknown>
        : null;
      if (override) {
        result.display = {
          ...result.display,
          ...override,
        } as typeof result.display;
      } else {
        result.display = undefined;
      }
    }
  }

  return result;
}

// ── Exported API ──

/**
 * 加载项目 YAML 配置文件。不存在或解析失败时返回 null。
 */
function loadProjectYAMLConfig(): Record<string, unknown> | null {
  const configPath = getProjectConfigPath();
  const data = loadYAMLFromFile(configPath);
  if (!data) return null;

  // Schema validation catches typos and type errors early
  const warnings = validateConfigObject(data);
  for (const w of warnings) {
    console.warn(`[config] Warning: ${configPath} — ${w.path}: ${w.message}`);
  }
  return data;
}

/**
 * Load and merge config:
 *
 *   1. `~/.nano-code/config.yaml` — 全局 YAML（system_plugins + env + 服务商+插件配置）
 *   2. `$CWD/.nano-code.yaml`     — 项目配置（覆盖全局）
 */
export function loadConfig(): NanoConfig {
  ensureDefaultYAML();

  const yamlData = loadYAMLConfig();
  applyYAMLEnv(yamlData);

  // 从 YAML 提取 system_plugins 和 system_prompt
  let systemPlugins: string[] | undefined;
  let systemPrompt: SystemPromptConfig | undefined;
  if (yamlData) {
    if (Array.isArray(yamlData.system_plugins)) {
      systemPlugins = yamlData.system_plugins.map(String);
    }
    if (isNonEmptyObject(yamlData.system_prompt)) {
      const sp = yamlData.system_prompt as Record<string, unknown>;
      systemPrompt = {
        withTools: typeof sp.with_tools === 'string' ? sp.with_tools : undefined,
        noTools: typeof sp.no_tools === 'string' ? sp.no_tools : undefined,
        projectFiles: Array.isArray(sp.project_files) ? sp.project_files.map(String) : undefined,
      };
    }
  }

  // 只取合并系统认识的三个字段，新加 YAML 字段无需修改此处
  const yamlMerge = yamlData ? pickMergeKeys(yamlData) : null;
  const result = mergeConfigs(yamlMerge, loadProjectYAMLConfig());
  result.systemPlugins = systemPlugins;
  result.systemPrompt = systemPrompt;
  return result;
}

function pickMergeKeys(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of CONFIG_TOP_KEYS) {
    if (key in data) result[key] = data[key];
  }
  return result;
}

/**
 * Apply an agent profile on top of a base configuration.
 * The profile's values override all base values.
 *
 * Profile lookup: `.nano-code/profiles/<name>.json` (project) first,
 * then `~/.nano-code/profiles/<name>.json` (global).
 *
 * Returns the merged config, or the base unchanged if the profile
 * was not found (a warning is printed).
 */
export function applyProfile(base: NanoConfig, profileName: string): NanoConfig {
  const profileConfig = loadProfileConfig(profileName);
  if (!profileConfig) {
    console.warn(`[config] agent profile "${profileName}" not found (checked project and global).`);
    return base;
  }

  const baseRaw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  return mergeConfigs(baseRaw, profileConfig);
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
 * 返回系统插件白名单（Set）。插件在此集合中则 CLI enable/disable 拒绝操作。
 */
export function getSystemWhitelist(config: NanoConfig): Set<string> {
  return new Set(config.systemPlugins || []);
}

/** @internal exported for testing */
export function _mergeConfigs(
  global: Record<string, unknown> | null,
  project: Record<string, unknown> | null,
): NanoConfig {
  return mergeConfigs(global, project);
}
