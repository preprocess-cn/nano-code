import { intro, text, outro, isCancel, confirm } from '@clack/prompts';
import { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, BackgroundTaskEvent, MessageLevel } from '#src/display.js';
import { isMainAgent } from '#src/core/contract.js';
import { formatToolCall } from '#src/plugins/display/tool-display.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';
import { askQuestionsDialog } from '#src/plugins/display/ask-questions-dialog.js';
import type { AskQuestionRequest } from '#src/plugins/tools/ask-user-question.js';
import * as readline from 'node:readline';

import type { PluginRegistry } from '#src/core/plugin.js';
import { SK } from '#src/core/store-keys.js';

/** 非主 agent 的消息加 [name] 前缀 */
function p(agentName: string, msg: string): string {
  return isMainAgent(agentName) ? msg : `[${agentName}] ${msg}`;
}

let showThink = false;
let debug = false;
const thinkFilter = new ThinkStream();
let _store: { get<T>(key: string): T | undefined } | null = null;

// ── Stream pager ──
const PAGE_THRESHOLD = 3000;  // chars — 超过此长度进入分页模式
const PAGE_MIN_OVERFLOW = 200; // 超过阈值至少这么多才会触发 pager
const PAGE_LINES = 20;        // 每页行数
let _streamBuffer = '';       // 当前 turn 全部输出缓冲
let _streamTotal = 0;         // 当前 turn 输出总长度
let _pagerPending = false;    // 是否需要分页展示

function getModeLabel(): string {
  if (!_store) return '';
  const taskCount = _store.get<number>(SK.TaskCount) ?? 0;
  return taskCount > 0 ? ` [\x1b[2m${taskCount} tasks\x1b[0m]` : '';
}

/** 分页展示 buffered 内容。返回 true = 全部显示完毕，false = 用户跳过 */
async function runPager(buffer: string): Promise<boolean> {
  const lines = buffer.split('\n');
  if (lines.length <= PAGE_LINES) {
    process.stdout.write(buffer);
    return true;
  }

  let pos = 0;
  const totalLines = lines.length;

  while (pos < totalLines) {
    const end = Math.min(pos + PAGE_LINES, totalLines);
    for (let i = pos; i < end; i++) {
      process.stdout.write(lines[i] + (i < totalLines - 1 ? '\n' : ''));
    }
    pos = end;

    if (pos >= totalLines) break;

    const remaining = totalLines - pos;
    const answer = await new Promise<string>(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt = `\x1b[2m[-- 剩余 ${remaining} 行 · Enter 继续 · a 全部显示 · Ctrl+C 退出 --]\x1b[0m `;
      rl.question(prompt, res => { rl.close(); resolve(res.toLowerCase()); });
      rl.on('SIGINT', () => { rl.close(); resolve('__exit__'); });
    });

    if (answer === '__exit__' || answer === 'q') return false;
    if (answer === 'a') {
      for (let i = pos; i < totalLines; i++) {
        process.stdout.write(lines[i] + (i < totalLines - 1 ? '\n' : ''));
      }
      break;
    }
  }
  return true;
}

export const replDisplay: DisplayPlugin = {
  name: 'repl',

  async onInit(registry: PluginRegistry): Promise<void> {
    _store = registry.store;
    registry.setConfirmCallback(async (req) => {
      console.log(`\n[!]  AI 正在申请执行：${req.displayName ?? req.toolName}`);
      if (req.details) console.log(`-> \x1b[33m${req.details}\x1b[0m`);
      const result = await confirm({ message: req.message, initialValue: true });
      if (typeof result === 'symbol' || !result) return false;
      return true;
    });
    registry.setOutputHandler({
      stdout(chunk: string) { process.stdout.write(chunk); },
      stderr(chunk: string) { process.stderr.write(chunk); },
    });
    // Register AskUserQuestion handler — uses raw-mode box dialog
    registry.registerInteractiveHandler('ask_user_question', async (args: any) => {
      const questions = args.questions as AskQuestionRequest[];
      const answers = await askQuestionsDialog(questions);
      return { status: 'success', data: JSON.stringify({ questions, answers }) };
    });
  },

  onStart(config: StartConfig): void {
    showThink = config.showThink === true;
    debug = config.debug || false;

    console.log('\n');
    intro('! nano-code 终端 AI 编程助手 启动中...');

    console.log('----------------------------------------------------');
    if (config.profileName) {
      console.log(` * 角色配置：${config.profileName}`);
    }
    console.log(` * 提示：${config.greeting}`);
    if (debug) {
      console.log(' * 调试模式已开启，将输出 LLM 交互的详细数据');
    }
    if (showThink && !debug) {
      console.log(' * 思考过程显示已开启，将输出 AI 思考过程');
    }
    console.log(' [!] 退出：输入 "exit"、"quit" 或直接按下 Ctrl+C 即可。');
    console.log('----------------------------------------------------\n');
  },

  onStop(message: string): void {
    outro(message);
  },

  async prompt(): Promise<string | null> {
    // 处理超出阈值的缓冲内容
    if (_streamTotal > PAGE_THRESHOLD && _streamBuffer.length > 0) {
      const overflow = _streamBuffer.slice(PAGE_THRESHOLD);
      if (_pagerPending && overflow.length > PAGE_MIN_OVERFLOW) {
        _pagerPending = false;
        process.stdout.write(`\n${'─'.repeat(40)}\n`);
        await runPager(overflow);
      } else {
        _pagerPending = false;
        // 溢出量不足分页，直接写入
        process.stdout.write(overflow);
      }
    }
    // 重置流状态
    _streamBuffer = '';
    _streamTotal = 0;
    _pagerPending = false;

    const mode = _store?.get<string>(SK.Mode) ?? 'normal';
    const planPrefix = mode === 'plan' ? '\x1b[33m(plan)\x1b[0m ' : '';
    const suffix = getModeLabel();
    const promptMsg = `${planPrefix}>>${suffix}  请输入开发任务或指令：`;
    const result = await text({
      message: promptMsg,
      placeholder: '例如："帮我看看这个项目的文件结构" 或 "创建一个 utils.ts 并在里面写一个冒泡排序"',
      validate: (value: string) => {
        if (!value.trim()) return '指令不能为空，请输入点什么吧！';
      },
    });

    if (isCancel(result)) return null;
    return (result as string).trim();
  },

  onUserInput(input: string, sourcePlugin: string): void {
    thinkFilter.reset();
    if (sourcePlugin === 'repl') return;
    const preview = input.length > 10 ? input.slice(0, 10) + '…' : input;
    console.log(`  [来自 ${sourcePlugin}] >> ${preview}`);
  },

  onStatus(event: StatusEvent): void {
    if (event.level === 'status') {
      if (event.message === 'thinking') {
        console.log(p(event.agentName, '? 正在思考并请求大模型...'));
      } else if (event.message === 'end' && isMainAgent(event.agentName)) {
        // 检查是否需要 pager：超过阈值且有足够溢出
        if (_streamTotal > PAGE_THRESHOLD && _streamTotal - PAGE_THRESHOLD > PAGE_MIN_OVERFLOW) {
          _pagerPending = true;
        }
      }
      return;
    }
    if (!event.message) return;
    const prefix = statusLevelPrefix(event.level);
    const output = event.level === 'error' ? process.stderr : process.stdout;
    const line = prefix + p(event.agentName, event.message);
    if (event.level === 'info') {
      output.write(`\x1b[2m${line}\x1b[0m\n`); // dim for info-level notifications
    } else {
      output.write(line + '\n');
    }
  },

  onStreamChunk(event: StreamEvent): void {
    if (!event.text) return;
    const text = showThink
      ? event.text.replace(/<think>/g, '\x1b[90m').replace(/<\/think>/g, '\x1b[0m')
      : thinkFilter.next(event.text);
    if (!text) return;
    if (isMainAgent(event.agentName)) {
      const prev = _streamTotal;
      _streamTotal += text.length;
      _streamBuffer += text;

      if (prev < PAGE_THRESHOLD) {
        // 阈值内直接输出
        const remaining = Math.min(text.length, PAGE_THRESHOLD - prev);
        process.stdout.write(text.slice(0, remaining));
        // 如果这个 chunk 跨越了阈值，输出阈值提示
        if (prev + text.length > PAGE_THRESHOLD) {
          process.stdout.write('\n\x1b[2m[输出较长，后续内容将在完成后分页展示]\x1b[0m\n');
        }
      }
      // 超过阈值后只缓冲，不写入 — 后续通过 pager 展示
    } else {
      const prefixed = text.split('\n').map(l => p(event.agentName, l)).join('\n');
      process.stdout.write(prefixed);
    }
  },

  onToolCall(event: ToolCallEvent): void {
    thinkFilter.reset();
    console.log(p(event.agentName, `\n#  ${formatToolCall(event.toolName, event.args)}`));
  },

  onToolResult(event: ToolResultEvent): void {
    switch (event.status) {
      case 'rejected_by_user':
        console.log(p(event.agentName, `[!] [拦截] 您拒绝了此操作。已强行终止后续的连带工具调用，并唤醒大模型向您解释...`));
        break;
      case 'error':
        console.log(p(event.agentName, `X [错误] 工具执行失败: ${event.message || '未知错误'}`));
        break;
      case 'success':
        console.log(p(event.agentName, `[OK] [成功] 工具执行完毕。`));
        break;
    }
  },

  onError(event: ErrorEvent): void {
    console.error(p(event.agentName, `${event.message}`));
    if (event.stack) {
      console.error(p(event.agentName, event.stack));
    }
  },

  onDebug(event: DebugEvent): void {
    if (!debug) return;
    console.log(p(event.agentName, event.data));
  },

  onBackgroundTask(event: BackgroundTaskEvent): void {
    const icon = event.taskStatus === 'started' ? '→' : event.taskStatus === 'completed' ? '✓' : '✗';
    const level = event.taskStatus === 'started' ? 'info' : event.taskStatus === 'completed' ? 'success' : 'error';
    const prefix = statusLevelPrefix(level);
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${prefix}[后台] ${event.message}\n`);
  },
};

function statusLevelPrefix(level: MessageLevel): string {
  switch (level) {
    case 'warn': return '\x1b[33m⚠\x1b[0m ';
    case 'error': return '\x1b[31m✗\x1b[0m ';
    case 'success': return '\x1b[32m✓\x1b[0m ';
    default: return '';
  }
}
