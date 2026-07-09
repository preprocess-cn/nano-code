/**
 * nano-code 配置类型定义。
 *
 * 本文件只包含类型定义，不包含任何配置加载/解析/合并实现。
 * 实现代码位于 src/bootstrap/config.ts。
 */

export interface AgentConfig {
  role?: string;     // agent 角色描述，用于系统提示（如"终端 AI 编程助手"）
  greeting?: string; // 启动时向用户显示的能力提示
  goodbye?: string;  // 退出时显示的消息（如"祝您编码愉快"）
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
  /** 配置格式版本，用于未来向后不兼容迁移。当前为 1。 */
  configVersion: number;
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
  /** MCP 服务器配置。 */
  mcp?: {
    /** 默认 stderr 日志过滤级别。只显示 >= 此级别的日志。--debug 时强制为 debug（全部放行）。默认 "warn"。 */
    stderrLevel?: 'debug' | 'info' | 'warn' | 'error';
  };
  /** 技能系统配置。对齐 Claude Code skill_listing / disableModelInvocation 机制。 */
  skills?: {
    /** 禁用的技能名列表。启动时检查，运行时修改需要重启生效 */
    disabled?: string[];
    /** 完全禁用 skill/skills_list/skill_view 工具（默认 false） */
    disableSkillTool?: boolean;
  };
}

/** A single validation warning about a config field. */
export interface ConfigValidationWarning {
  path: string;
  message: string;
}
