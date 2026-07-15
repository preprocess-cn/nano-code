// ── 权限模式 ──
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';

// ── 规则来源 ──
export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'cliArg'
  | 'command'
  | 'session';

export type PermissionRuleBehavior = 'allow' | 'deny' | 'ask';

export interface PermissionRuleValue {
  /** 工具名（如 Read、Bash、Write、Patch），匹配 displayName */
  toolName: string;
  /** 规则内容：路径模式 / bash 命令模式 / undefined(工具级通配) */
  ruleContent?: string;
}

export interface PermissionRule {
  source: PermissionRuleSource;
  ruleBehavior: PermissionRuleBehavior;
  ruleValue: PermissionRuleValue;
}

// ── 评估结果 ──

export type PermissionDecision =
  | { behavior: 'allow'; reason?: string; skipPermission?: boolean }
  | { behavior: 'ask'; message: string; suggestions?: PermissionUpdate[]; reason?: string }
  | { behavior: 'deny'; message: string; reason?: string };

export type PermissionDecisionReason =
  | { type: 'rule'; rule: string }
  | { type: 'mode'; mode: string }
  | { type: 'workingDir'; path: string }
  | { type: 'safetyCheck' }
  | { type: 'other'; reason: string };

// ── 用户操作后可应用的更新 ──

export interface PermissionUpdate {
  type: 'addRule' | 'addDirectory' | 'setMode';
  rule?: PermissionRule;
  directory?: string;
  mode?: PermissionMode;
  scope?: 'session' | 'persistent';
}

// ── 权限插件配置（来自 .nano-code.yaml permissions: 块） ──

export interface PermissionPluginConfig {
  mode?: PermissionMode;
  additionalDirectories?: string[];
  rules?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
}

// ── Store 注册用的回调类型 ──

export type PermissionEvaluatorFn = (
  toolName: string,
  args: any,
  sideEffect: boolean,
) => Promise<PermissionDecision>;

export const PERMISSION_MANAGER_KEY = 'permission:manager';
