import { PermissionRule, PermissionRuleValue, PermissionRuleBehavior, PermissionRuleSource } from './types.js';

// ── 规则字符串解析 ──

/**
 * 解析 "ToolName(content)" 格式的规则字符串。
 *
 * 格式示例:
 *   Read(/home/user/**)
 *   Bash(npm *)
 *   Bash(npm:*)
 *   Write()
 *   Write
 *   Read
 */
export function parseRuleString(input: string): PermissionRuleValue {
  const trimmed = input.trim();

  // 尝试匹配 ToolName(content) 格式
  const parenIndex = trimmed.indexOf('(');
  if (parenIndex === -1) {
    // 无括号: 整个字符串就是工具名（工具级通配）
    return { toolName: trimmed };
  }

  const toolName = trimmed.slice(0, parenIndex);
  const rest = trimmed.slice(parenIndex + 1);

  // 找到最后一个 )，必须结尾
  const closeParen = rest.lastIndexOf(')');
  if (closeParen !== rest.length - 1) {
    // 格式不合法，当作工具级通配
    return { toolName: trimmed };
  }

  let content = rest.slice(0, closeParen).trim();

  // 空括号 () 或括号内 * → 工具级通配
  if (content === '' || content === '*') {
    return { toolName };
  }

  return { toolName, ruleContent: content };
}

// ── 模式匹配 (路径 / bash 命令) ──

/**
 * gitignore 风格路径模式匹配。
 * 支持: ** (跨段通配), * (段内通配)
 * 不支持: ?, [...]
 */
export function matchPathPattern(pattern: string, targetPath: string): boolean {
  // 规范化: 去除末尾 /
  const cleanPattern = pattern.replace(/\/+$/, '');
  const cleanTarget = targetPath.replace(/\/+$/, '');

  // 如果 pattern 以 /** 结尾 → 匹配目录下所有内容
  if (cleanPattern.endsWith('/**')) {
    const prefix = cleanPattern.slice(0, -3);
    return cleanTarget === prefix || cleanTarget.startsWith(prefix + '/');
  }

  // 如果 pattern 以 /* 结尾 → 匹配直接子级
  if (cleanPattern.endsWith('/*')) {
    const prefix = cleanPattern.slice(0, -2);
    if (!cleanTarget.startsWith(prefix + '/')) return false;
    const remainder = cleanTarget.slice(prefix.length + 1);
    return !remainder.includes('/');
  }

  // 不含通配符 → 前缀匹配（作为目录前缀）
  if (!cleanPattern.includes('*')) {
    return cleanTarget === cleanPattern || cleanTarget.startsWith(cleanPattern + '/');
  }

  // 含通配符 → 转换为正则
  return matchGlobPattern(cleanPattern, cleanTarget);
}

/**
 * 通配符模式匹配。
 * * 匹配任意字符（包括 /）
 */
function matchGlobPattern(pattern: string, target: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符
    .replace(/\*/g, '[^/]*')               // * 匹配段内任意字符
    .replace(/\*\*/g, '.*');               // ** 匹配任意字符（跨段）

  try {
    return new RegExp(`^${regexStr}$`).test(target);
  } catch {
    return false;
  }
}

/**
 * Bash 命令模式匹配。
 * 支持:
 *   - 精确匹配: "npm install"
 *   - 前缀匹配: "npm:*" （冒号+通配符前缀语法）
 *   - 通配: "npm *" (glob 风格)
 */
export function matchCommandPattern(pattern: string, command: string): boolean {
  const trimmedCmd = command.trim();

  // 前缀匹配 (CC 兼容): npm:* → npm 开头的所有命令
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return trimmedCmd === prefix || trimmedCmd.startsWith(prefix + ' ');
  }

  // 如果 pattern 包含 *，通配匹配
  if (pattern.includes('*')) {
    // 尾部 " *" 模式也匹配裸命令
    if (pattern.endsWith(' *') && trimmedCmd === pattern.slice(0, -2).trimEnd()) {
      return true;
    }

    return matchGlobPattern(pattern, trimmedCmd);
  }

  // 无通配符: 精确匹配
  return trimmedCmd === pattern;
}

// ── 工具参数内容提取 ──

/**
 * 根据工具名+参数提取检查内容。
 * 返回可被规则匹配的 content 字符串，或 undefined。
 */
export function extractMatchContent(toolName: string, args: any): {
  path?: string;
  command?: string;
} {
  switch (toolName) {
    case 'view_file_content':
    case 'list_project_files':
      return { path: args?.path ?? process.cwd() };

    case 'write_file_content':
    case 'patch_file':
      return { path: args?.path };

    case 'run_bash_command':
      return { command: typeof args?.command === 'string' ? args.command.trim() : undefined };

    default:
      return {};
  }
}

// ── RuleStore ──

export class RuleStore {
  private allowRules: PermissionRule[] = [];
  private denyRules: PermissionRule[] = [];
  private askRules: PermissionRule[] = [];

  /**
   * 批量添加规则。
   * 按 behavior 分入对应集合。
   */
  addRules(rules: PermissionRule[]): void {
    for (const rule of rules) {
      switch (rule.ruleBehavior) {
        case 'allow':
          this.allowRules.push(rule);
          break;
        case 'deny':
          this.denyRules.push(rule);
          break;
        case 'ask':
          this.askRules.push(rule);
          break;
      }
    }
  }

  /** 清空所有规则 */
  clear(): void {
    this.allowRules = [];
    this.denyRules = [];
    this.askRules = [];
  }

  // ── 工具级匹配 ──

  /**
   * 工具级 deny: 只看 toolName，不看 content。
   * 返回第一个匹配的 deny 规则。
   */
  matchToolDeny(toolName: string): PermissionRule | null {
    return findToolLevelRule(this.denyRules, toolName);
  }

  /**
   * 工具级 ask: 只看 toolName。
   */
  matchToolAsk(toolName: string): PermissionRule | null {
    return findToolLevelRule(this.askRules, toolName);
  }

  /**
   * 工具级 allow: 只看 toolName。
   */
  matchToolAllow(toolName: string): PermissionRule | null {
    return findToolLevelRule(this.allowRules, toolName);
  }

  // ── 内容级匹配 ──

  /**
   * 内容级 deny: toolName + content 同时匹配。
   */
  matchContentDeny(toolName: string, content: string): PermissionRule | null {
    return findContentLevelRule(this.denyRules, toolName, content);
  }

  /**
   * 内容级 ask: toolName + content 同时匹配。
   */
  matchContentAsk(toolName: string, content: string): PermissionRule | null {
    return findContentLevelRule(this.askRules, toolName, content);
  }

  /**
   * 内容级 allow: toolName + content 同时匹配。
   */
  matchContentAllow(toolName: string, content: string): PermissionRule | null {
    return findContentLevelRule(this.allowRules, toolName, content);
  }

  /** 获取所有规则（用于序列化/展示） */
  getAllRules(): { allow: PermissionRule[]; deny: PermissionRule[]; ask: PermissionRule[] } {
    return {
      allow: [...this.allowRules],
      deny: [...this.denyRules],
      ask: [...this.askRules],
    };
  }
}

// ── 内部匹配函数 ──

/** 工具级规则匹配：规则的 ruleContent 为 undefined（工具级通配） */
function findToolLevelRule(rules: PermissionRule[], toolName: string): PermissionRule | null {
  for (const rule of rules) {
    if (rule.ruleValue.ruleContent === undefined && rule.ruleValue.toolName === toolName) {
      return rule;
    }
  }
  return null;
}

/** 内容级规则匹配：规则的 ruleContent 与 content 匹配 */
function findContentLevelRule(
  rules: PermissionRule[],
  toolName: string,
  content: string,
): PermissionRule | null {
  for (const rule of rules) {
    if (rule.ruleValue.toolName !== toolName) continue;
    const rc = rule.ruleValue.ruleContent;
    if (rc === undefined) continue; // 工具级规则在 findToolLevelRule 中处理

    // 路径匹配
    if (matchPathPattern(rc, content)) return rule;
    // 命令匹配
    if (matchCommandPattern(rc, content)) return rule;
  }
  return null;
}
