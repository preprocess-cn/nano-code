import * as path from 'path';
import { PermissionPluginConfig, PermissionMode, PermissionRule, PermissionRuleSource } from './types.js';
import { parseRuleString } from './rule.js';
import { PermissionManager } from './permission.js';

/**
 * 从 PermissionPluginConfig 创建 PermissionManager。
 *
 * 1. 解析 mode
 * 2. 解析 rule 字符串 → PermissionRule[]
 * 3. 解析 additionalDirectories → 绝对路径
 * 4. 构建 PermissionManager
 * 5. 添加 rules + directories
 */
export function createPermissionManager(
  config: PermissionPluginConfig,
  cwd: string,
): PermissionManager {
  // 1. 确定 mode
  const mode: PermissionMode = config.mode ?? 'default';

  // 2. 创建 manager
  const manager = new PermissionManager({ mode, cwd });

  // 3. 添加 rules
  const rules: PermissionRule[] = [];

  if (config.rules) {
    for (const raw of config.rules.allow ?? []) {
      rules.push({
        source: 'projectSettings',
        ruleBehavior: 'allow',
        ruleValue: parseRuleString(raw),
      });
    }
    for (const raw of config.rules.deny ?? []) {
      rules.push({
        source: 'projectSettings',
        ruleBehavior: 'deny',
        ruleValue: parseRuleString(raw),
      });
    }
    for (const raw of config.rules.ask ?? []) {
      rules.push({
        source: 'projectSettings',
        ruleBehavior: 'ask',
        ruleValue: parseRuleString(raw),
      });
    }
  }

  manager.addRules(rules);

  // 4. 添加 additionalDirectories（已是绝对路径，在 bootstrap/config.ts 中解析）
  for (const dir of config.additionalDirectories ?? []) {
    const resolved = path.resolve(cwd, dir);
    manager.addDirectory(resolved, 'projectSettings');
  }

  return manager;
}
