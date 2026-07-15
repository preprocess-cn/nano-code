import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { PermissionEvaluatorFn, PermissionPluginConfig, PERMISSION_MANAGER_KEY } from './types.js';
import { createPermissionManager } from './setup.js';
import { SK } from '#src/store-keys.js';
import { logManager } from '#src/utils/logger.js';
import { setPermissionPluginActive } from '#src/plugins/tools/fs.js';

export function createPermissionPlugin(): NanoPlugin {
  let registry: PluginRegistry | undefined;

  return {
    name: 'permission',
    description: 'Advanced permission control — path validation, rules engine, mode management',

    /** 纯 service 插件，不提供任何工具 */
    getTools() {
      return [];
    },

    async execute(_name: string, _args: any, _ctx: any): Promise<import('#src/core/contract.js').ToolResponse> {
      return { status: 'error', message: 'Permission plugin does not provide executable tools' };
    },

    async onInit(r: PluginRegistry): Promise<void> {
      registry = r;

      // 默认激活（mode: default）。用户可通过 config.permissions 覆盖设置
      const userConfig = registry.getPluginConfig('permission') as PermissionPluginConfig | undefined;
      const config: PermissionPluginConfig = userConfig ?? { mode: 'default' };

      const cwd = process.cwd();
      const manager = createPermissionManager(config, cwd);

      // 注册评估器到 store — agent.ts executeToolCall 从 store 取
      const evaluatorFn: PermissionEvaluatorFn = (toolName, args, sideEffect) =>
        manager.evaluate(toolName, args, sideEffect);

      registry.store.set(SK.PermissionEvaluator, evaluatorFn);
      registry.store.set(PERMISSION_MANAGER_KEY, manager);

      // 通知文件系统插件权限插件已激活，SafeResolvePath 应放行
      setPermissionPluginActive(true);

      logManager.info('permission', `Permission manager initialized (mode: ${manager.getMode()})`);
    },

    async onDestroy(): Promise<void> {
      if (registry) {
        registry.store.set(SK.PermissionEvaluator, undefined);
        registry.store.set(PERMISSION_MANAGER_KEY, undefined);
        setPermissionPluginActive(false);
      }
    },
  };
}
