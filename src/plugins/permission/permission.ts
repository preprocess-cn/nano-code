import {
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  PermissionUpdate,
} from './types.js';
import { RuleStore, extractMatchContent } from './rule.js';
import { PathValidator } from './path-validator.js';

// ── 危险命令模式（原 command.ts 的 DANGEROUS_COMMAND_BLACKLIST） ──

export const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[rfvIS]*[rf][rfvIS]*\s+([\/\.\*~]|\w+)/i,
  /\b(mkfs(\..*)?|dd|fdisk|parted)\b/i,
  /\b(shutdown|reboot|poweroff|init\s+[06])\b/i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\b(nc|netcat|bash\s+-i|sh\s+-i)\b.*\b(exec|tcp|udp)\b/i,
  /\b(passwd|userdel|groupdel|chsh)\b/i,
];

// ── PermissionManager ──

export class PermissionManager {
  private ruleStore: RuleStore;
  private pathValidator: PathValidator;
  private mode: PermissionMode;

  constructor(config: { mode: PermissionMode; cwd: string }) {
    this.mode = config.mode || 'default';
    this.ruleStore = new RuleStore();
    this.pathValidator = new PathValidator(config.cwd);
  }

  // ── 配置 ──

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  addRules(rules: PermissionRule[]): void {
    this.ruleStore.addRules(rules);
  }

  /** 动态添加一条 session 级路径规则（用户点"始终允许"时调用） */
  addSessionRule(behavior: import('./types.js').PermissionRuleBehavior, toolName: string, ruleContent?: string): void {
    this.ruleStore.addRules([{
      source: 'session',
      ruleBehavior: behavior,
      ruleValue: { toolName, ruleContent },
    }]);
  }

  addDirectory(dir: string, source: import('./types.js').PermissionRuleSource): void {
    this.pathValidator.addDirectory(dir, source);
  }

  getPathValidator(): PathValidator {
    return this.pathValidator;
  }

  getRuleStore(): RuleStore {
    return this.ruleStore;
  }

  // ── 评估管道 ──

  async evaluate(
    toolName: string,
    args: any,
    sideEffect: boolean,
  ): Promise<PermissionDecision> {
    // Step 0: 提取检查内容
    const content = extractMatchContent(toolName, args);
    const matchText = content.command ?? content.path;

    // ── Step 1: deny 规则 ──

    // 工具级 deny: toolA 允许所有，toolB 全部拒绝
    const toolDeny = this.ruleStore.matchToolDeny(toolName);
    if (toolDeny) {
      return { behavior: 'deny', message: `工具 "${toolName}" 已被规则拒绝`, reason: 'tool-deny' };
    }

    // 内容级 deny: Bash(rm *) 拒绝特定内容
    if (matchText) {
      const contentDeny = this.ruleStore.matchContentDeny(toolName, matchText);
      if (contentDeny && contentDeny.ruleValue.ruleContent) {
        return {
          behavior: 'deny',
          message: `命令 "${content.command ?? content.path}" 已被规则拒绝: ${contentDeny.ruleValue.ruleContent}`,
          reason: 'content-deny',
        };
      }
    }

    // ── Step 2: 工具级 ask 规则 ──

    const toolAsk = this.ruleStore.matchToolAsk(toolName);
    if (toolAsk) {
      return {
        behavior: 'ask',
        message: `工具 "${toolName}" 需要您的批准`,
      };
    }

    // ── Step 3: 路径级检查 ──

    if (content.path) {
      const isWrite = ['write_file_content', 'patch_file'].includes(toolName);
      const pathDecision = isWrite
        ? this.pathValidator.checkWritePermission(content.path, this.mode)
        : this.pathValidator.checkReadPermission(content.path);
      if (pathDecision.behavior !== 'allow') {
        return pathDecision;
      }
    }

    // ── Step 4: 内容级 ask 规则 ──

    if (matchText) {
      const contentAsk = this.ruleStore.matchContentAsk(toolName, matchText);
      if (contentAsk) {
        return {
          behavior: 'ask',
          message: `操作 "${matchText}" 需要您的批准`,
        };
      }
    }

    // ── Step 5: 安全检查 — 危险命令 ──

    if (content.command) {
      const isDangerous = DANGEROUS_COMMAND_PATTERNS.some(re => re.test(content.command!));
      if (isDangerous) {
        return {
          behavior: 'deny',
          message: '危险命令已被权限系统拦截，如需执行请手动在终端中操作',
          reason: 'safetyCheck',
        };
      }
    }

    // ── Step 6: bypassPermissions 模式 ──

    if (this.mode === 'bypassPermissions') {
      return { behavior: 'allow', skipPermission: true };
    }

    // ── Step 7: allow 规则 ──

    // 工具级 allow
    const toolAllow = this.ruleStore.matchToolAllow(toolName);
    if (toolAllow) {
      return { behavior: 'allow', reason: 'tool-allow' };
    }

    // 内容级 allow
    if (matchText) {
      const contentAllow = this.ruleStore.matchContentAllow(toolName, matchText);
      if (contentAllow) {
        return { behavior: 'allow', reason: 'content-allow' };
      }
    }

    // ── Step 8: 默认行为 ──

    // 只读工具 → 自动放行
    if (!sideEffect) {
      return { behavior: 'allow', reason: 'readonly tool' };
    }

    // acceptEdits 模式 + 路径已在 PathValidator 检查中 pass
    // （如果路径检查返回 allow，不会进入这一步）

    // default 模式 + sideEffect → ask
    if (this.mode === 'default') {
      return { behavior: 'ask', message: `工具 "${toolName}" 需要您的批准` };
    }

    // dontAsk 模式 + sideEffect → deny
    if (this.mode === 'dontAsk') {
      return {
        behavior: 'deny',
        message: '当前模式 (dontAsk) 禁止所有需批准的调用',
        reason: 'mode-dontAsk',
      };
    }

    // acceptEdits 模式 → 没有路径检查（非文件工具）或无特定规则 → ask
    // 文件工具已经过 Step 3 的路径检查
    if (content.path) {
      // 路径已通过路径检查（此时为 allow），这里不会再走到
      return { behavior: 'allow', reason: 'path-check-passed' };
    }

    return { behavior: 'ask', message: `工具 "${toolName}" 需要您的批准` };
  }
}
