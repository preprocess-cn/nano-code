import { spawn } from 'child_process';
import { NanoPlugin } from '../../core/plugin.js';
import { CommandInterceptResult } from '../../core/contract.js';
import { DisplayManager } from '../../display.js';

/**
 * 危险命令黑名单（复用 command.ts 中的模式）
 */
const DANGEROUS_COMMAND_BLACKLIST = [
  /\brm\s+-[rfvIS]*[rf][rfvIS]*\s+([\/\.\*~]|\w+)/i,
  /\b(mkfs(\..*)?|dd|fdisk|parted)\b/i,
  /\b(shutdown|reboot|poweroff|init\s+[06])\b/i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\b(nc|netcat|bash\s+-i|sh\s+-i)\b.*\b(exec|tcp|udp)\b/i,
  /\b(passwd|userdel|groupdel|chsh)\b/i,
];

const LOG_LIMIT = 4000;

export function createBangPlugin(display?: DisplayManager): NanoPlugin {
  return {
    name: 'bang',
    description: '叹号 bash 执行 — !<命令> 直接执行 shell 命令',

    getTools() { return []; },
    async execute() { return { status: 'error', message: 'bang 插件不提供工具调用' }; },

    async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
      if (!input.startsWith('!')) return null;

      const command = input.slice(1).trim();
      if (!command) {
        display?.onStatus({ message: '! 后请键入要执行的命令', agentName: 'main', level: 'warn' });
        return { handled: true, skipAgent: true };
      }

      // 黑名单检查
      if (DANGEROUS_COMMAND_BLACKLIST.some(regex => regex.test(command))) {
        display?.onStatus({ message: '该命令被系统安全策略禁止', agentName: 'main', level: 'warn' });
        return { handled: true, skipAgent: true };
      }

      display?.onStatus({ message: `>> 正在执行: ${command}`, agentName: 'main', level: 'info' });

      try {
        const result = await new Promise<string>((resolve) => {
          const child = spawn(command, {
            shell: true,
            cwd: process.cwd(),
            env: { ...process.env, CI: 'true' },
          });

          let stdout = '';
          let stderr = '';

          child.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            process.stdout.write(chunk);
          });

          child.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            process.stderr.write(chunk);
          });

          const timer = setTimeout(() => {
            child.kill();
            resolve(`\n[超时] 命令执行超时（30000ms），已终止`);
          }, 30000);

          child.on('close', (code) => {
            clearTimeout(timer);
            let combined = '';
            if (stdout) combined += stdout;
            if (stderr) combined += `\n[stderr]\n${stderr}`;
            if (!combined) combined = '(命令无输出)';

            if (combined.length > LOG_LIMIT * 2) {
              const head = combined.slice(0, LOG_LIMIT);
              const tail = combined.slice(-LOG_LIMIT);
              combined = `${head}\n\n... [输出过长，已截断] ...\n\n${tail}`;
            }

            if (code !== 0) {
              resolve(`\n[进程退出码: ${code}]`);
            } else {
              resolve('');
            }
          });
        });

        if (result) {
          process.stdout.write(result + '\n');
        }
      } catch (err: any) {
        display?.onError({ message: `执行失败: ${err.message}`, agentName: 'main' });
      }

      return { handled: true, skipAgent: true };
    },
  };
}
