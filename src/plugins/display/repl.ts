import { intro, text, outro, isCancel, confirm } from '@clack/prompts';
import { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent } from '../../display.js';
import { isMainAgent } from '../../contract.js';
import { formatStatusText } from '../../display-strings.js';
import { ThinkStream } from './think-stream.js';
import type { PluginRegistry } from '../../plugin.js';
import { getCurrentAgentMode } from '../commands/agent-slash.js';

/** 非主 agent 的消息加 [name] 前缀 */
function p(agentName: string, msg: string): string {
  return isMainAgent(agentName) ? msg : `[${agentName}] ${msg}`;
}

let showThink = false;
let debug = false;
const thinkFilter = new ThinkStream();

export const replDisplay: DisplayPlugin = {
  name: 'repl',

  async onInit(registry: PluginRegistry): Promise<void> {
    registry.setConfirmCallback(async (req) => {
      console.log(`\n[!]  AI 正在申请执行：${req.toolName}`);
      if (req.details) console.log(`-> \x1b[33m${req.details}\x1b[0m`);
      const result = await confirm({ message: req.message, initialValue: true });
      if (typeof result === 'symbol' || !result) return false;
      return true;
    });
    registry.setOutputHandler({
      stdout(chunk: string) { process.stdout.write(chunk); },
      stderr(chunk: string) { process.stderr.write(chunk); },
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
    const agentMode = getCurrentAgentMode();
    const promptMsg = agentMode ? `[${agentMode.name}] >>  请输入开发任务或指令：` : '>>  请输入开发任务或指令：';
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
    const text = formatStatusText(event.message);
    if (text) console.log(p(event.agentName, text));
  },

  onStreamChunk(event: StreamEvent): void {
    if (!event.text) return;
    const text = showThink
      ? event.text.replace(/<think>/g, '\x1b[90m').replace(/<\/think>/g, '\x1b[0m')
      : thinkFilter.next(event.text);
    if (!text) return;
    if (isMainAgent(event.agentName)) {
      process.stdout.write(text);
    } else {
      const prefixed = text.split('\n').map(l => p(event.agentName, l)).join('\n');
      process.stdout.write(prefixed);
    }
  },

  onToolCall(event: ToolCallEvent): void {
    thinkFilter.reset();
    console.log(p(event.agentName, `\n#  AI 申请调用本地工具: [ ${event.toolName} ]`));
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
};
