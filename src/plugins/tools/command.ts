import { spawn } from 'child_process';
import { confirm } from '@clack/prompts';
import { NanoPlugin } from '../../core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../core/contract.js';

/**
 * [LOCK] 危险命令黑名单模式列表
 */
const DANGEROUS_COMMAND_BLACKLIST = [
  /\brm\s+-[rfvIS]*[rf][rfvIS]*\s+([\/\.\*~]|\w+)/i,  // 毁灭性删除 (rm -rf /, rm -rf *)
  /\b(mkfs(\..*)?|dd|fdisk|parted)\b/i,               // 磁盘物理破坏 (dd, mkfs)
  /\b(shutdown|reboot|poweroff|init\s+[06])\b/i,      // 系统关机重启
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,   // Fork 炸弹死循环
  /\b(nc|netcat|bash\s+-i|sh\s+-i)\b.*\b(exec|tcp|udp)\b/i, // 反弹 Shell 远程控制
  /\b(passwd|userdel|groupdel|chsh)\b/i               // 篡改系统核心用户
];

/**
 * -- 日志截断阈值定义 (前 4KB + 后 4KB)
 */
const LOG_LIMIT = 4000;

/**
 * 原生命令行确认对象
 */
const userConfirmation = {
  async ask(query: string): Promise<boolean> {
    const result = await confirm({
      message: query,
      initialValue: true,
    });

    if (typeof result === 'symbol') {
      return false;
    }
    return result;
  }
};

// Re-export for test compatibility (confirmation mocking)
export { userConfirmation };

export const commandPlugin: NanoPlugin = {
  name: 'command',
  description: 'Bash command execution tool',
  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'run_bash_command',
          description: '在用户的本地终端执行一个 Bash 命令行指令（例如：安装依赖、运行测试、编译代码等）。该操作会在物理磁盘生效，请谨慎输入。',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: '准备在终端执行的完整 Bash 命令行语句（例如：npm run build）'
              }
            },
            required: ['command']
          },
          sideEffect: true,
        }
      }
    ];
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case 'run_bash_command': {
        try {
          if (!args.command) {
            return {
              status: 'error',
              message: 'Error: Missing required parameter "command".'
            };
          }

          const trimmedCmd = args.command.trim();
          const isDangerous = DANGEROUS_COMMAND_BLACKLIST.some(regex => regex.test(trimmedCmd));

          if (isDangerous) {
            return {
              status: 'error',
              message: `CRITICAL SECURITY VIOLATION: The command "${trimmedCmd}" matches our system security blacklist! This action has been silently BLOCKED by the kernel. DO NOT try to bypass this filter or run similar infrastructure-destructive commands.`
            };
          }

          if (!ctx.skipPermission && ctx.sideEffect) {
            const confirmed = ctx.confirmCallback
              ? await ctx.confirmCallback({ toolName: 'command', message: '是否批准在您的本地电脑运行此命令？', details: args.command })
              : await userConfirmation.ask('[?] 是否批准在您的本地电脑运行此命令？');

            if (!confirmed) {
              return {
                status: 'rejected_by_user',
                message: 'Command execution rejected by user.'
              };
            }
          }

          const out = ctx.outputHandler;
          if (out) out.stdout('>> 正在执行中，请稍候...\n');
          else console.log('>> 正在执行中，请稍候...');

          return await new Promise<ToolResponse>((resolve) => {
            const child = spawn(trimmedCmd, {
              shell: true,
              cwd: process.cwd(),
              env: { ...process.env, CI: 'true' }
            });

            let stdoutAccumulator = '';
            let stderrAccumulator = '';

            child.stdout.on('data', (data) => {
              const chunk = data.toString();
              stdoutAccumulator += chunk;
              if (out) out.stdout(chunk);
              else process.stdout.write(chunk);
            });

            child.stderr.on('data', (data) => {
              const chunk = data.toString();
              stderrAccumulator += chunk;
              if (out) out.stderr(chunk);
              else process.stderr.write(chunk);
            });

            const timeoutTimer = setTimeout(() => {
              child.kill();
              resolve({
                status: 'error',
                message: `Command execution timed out after ${ctx.defaultTimeout}ms.`
              });
            }, ctx.defaultTimeout);

            child.on('close', (code) => {
              clearTimeout(timeoutTimer);

              let combinedLog = '';
              if (stdoutAccumulator) combinedLog += `[stdout]:\n${stdoutAccumulator}\n`;
              if (stderrAccumulator) combinedLog += `[stderr]:\n${stderrAccumulator}\n`;
              if (!combinedLog) combinedLog = 'Command executed with no output.';

              if (combinedLog.length > LOG_LIMIT * 2) {
                const head = combinedLog.slice(0, LOG_LIMIT);
                const tail = combinedLog.slice(-LOG_LIMIT);
                combinedLog = `${head}\n\n... [...中间日志过长 (${combinedLog.length} 字符)，系统已自动截断以节省 Context...] ...\n\n${tail}`;
              }

              if (code !== 0) {
                resolve({
                  status: 'error',
                  message: `Command failed with exit code ${code}.\n${combinedLog}`
                });
              } else {
                resolve({
                  status: 'success',
                  data: combinedLog
                });
              }
            });
          });
        } catch (err: any) {
          return {
            status: 'error',
            message: `Command trigger collapsed: ${err.message}`
          };
        }
      }

      default:
        throw new Error(`未找到匹配的 Command 工具: ${name}`);
    }
  },
};
