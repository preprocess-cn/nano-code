import { spawn } from 'child_process';
import { NanoPlugin } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';
import { DANGEROUS_COMMAND_BLACKLIST, userConfirmation } from '#src/plugins/tools/command.js';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const LOG_LIMIT = 4000;


export const monitorPlugin: NanoPlugin = {
  name: 'monitor',
  description: 'Monitor command output tool — run a command and watch for a pattern',
  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'monitor',
          description: `执行一个命令并监控其输出，当匹配到指定模式时提前返回。
适用于等待构建完成、监视日志错误等场景。

- 提供 \`pattern\` 参数：当输出中出现匹配的行时立即返回（不等进程结束）
- 不提供 \`pattern\` 参数：等待进程结束或超时后返回全部输出
- 超时时间默认为 120 秒，最长 600 秒`,
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: '要执行的 Shell 命令（如 "npm run build"、"tail -f log/server.log"）',
              },
              pattern: {
                type: 'string',
                description: '可选的等待模式（正则表达式）。匹配到该模式的输出行出现时提前返回，不等进程结束。如 "Build successful"、"error|Error|ERROR"',
              },
              timeout: {
                type: 'number',
                description: '超时时间（毫秒），默认 120000，最大 600000',
                default: 120_000,
              },
            },
            required: ['command'],
          },
          sideEffect: true,
        },
      },
    ];
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    if (name !== 'monitor') {
      throw new Error(`未找到匹配的工具: ${name}`);
    }

    try {
      if (!args.command) {
        return { status: 'error', message: '缺少必填参数 "command"。' };
      }

      const trimmedCmd = args.command.trim();
      const isDangerous = DANGEROUS_COMMAND_BLACKLIST.some(regex => regex.test(trimmedCmd));

      if (isDangerous) {
        return {
          status: 'error',
          message: `安全拦截：命令 "${trimmedCmd}" 匹配系统安全黑名单，已阻止执行。`,
        };
      }

      const pattern = args.pattern ? String(args.pattern) : undefined;
      const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
      const out = ctx.outputHandler;

      if (out) out.stdout(`>> 正在执行: ${trimmedCmd}\n`);

      return await new Promise<ToolResponse>((resolve, reject) => {
        const child = spawn(trimmedCmd, {
          shell: true,
          cwd: process.cwd(),
          env: { ...process.env, CI: 'true' },
        });

        let output = '';
        let matched = false;
        let matchedLine = '';
        let timer: NodeJS.Timeout | undefined;

        const tryMatch = (text: string): void => {
          if (!pattern || matched) return;
          for (const line of text.split('\n')) {
            if (line.match(pattern)) {
              matched = true;
              matchedLine = line.trim();
              break;
            }
          }
          if (matched) {
            clearTimeout(timer);
            child.kill();
          }
        };

        const appendOutput = (chunk: Buffer | string): void => {
          try {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            output += text;
            if (out) out.stdout(text);
            tryMatch(text);
            if (matched) finish('match');
          } catch (err: unknown) {
            if (!finished) {
              finished = true;
              clearTimeout(timer);
              resolve({ status: 'error', message: `monitor 处理输出异常: ${err instanceof Error ? err.message : String(err)}` });
            }
          }
        };

        child.stdout.on('data', appendOutput);
        child.stderr.on('data', appendOutput);

        timer = setTimeout(() => {
          child.kill();
          finish('timeout');
        }, timeoutMs);

        let finished = false;
        const finish = (reason: 'exit' | 'match' | 'timeout' | 'kill') => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);

          if (output.length > LOG_LIMIT * 2) {
            const head = output.slice(0, LOG_LIMIT);
            const tail = output.slice(-LOG_LIMIT);
            output = `${head}\n\n... [输出过长 (${output.length} 字符)，已截断] ...\n\n${tail}`;
          }

          resolve({
            status: 'success',
            message: output || '命令无输出。',
            data: JSON.stringify({ reason, matched, matchedLine, output: output || '' }),
          });
        };

        child.on('close', (code) => {
          if (!finished) {
            finish(code === 0 ? 'exit' : 'exit');
          }
        });

        child.on('error', (err) => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            resolve({ status: 'error', message: `进程启动失败: ${err.message}` });
          }
        });

      });
    } catch (err: any) {
      return { status: 'error', message: `monitor 执行失败: ${err.message}` };
    }
  },
};
