import { intro, text, outro, isCancel } from '@clack/prompts';
import { DisplayPlugin, StartConfig, StatusEvent, StreamEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, DebugEvent, isMainAgent } from '../../display.js';

/** 非主 agent 的消息加 [name] 前缀 */
function p(agentName: string, msg: string): string {
  return isMainAgent(agentName) ? msg : `[${agentName}] ${msg}`;
}

export const replDisplay: DisplayPlugin = {
  name: 'repl',

  onStart(config: StartConfig): void {
    console.log('\n');
    intro('! nano-code 终端 AI 编程助手 启动中...');

    console.log('----------------------------------------------------');
    if (config.profileName) {
      console.log(` * 角色配置：${config.profileName}`);
    }
    console.log(` * 提示：${config.greeting}`);
    console.log(' [!] 退出：输入 "exit"、"quit" 或直接按下 Ctrl+C 即可。');
    console.log('----------------------------------------------------\n');
  },

  onStop(message: string): void {
    outro(message);
  },

  async prompt(): Promise<string | null> {
    const result = await text({
      message: '>>  请输入开发任务或指令：',
      placeholder: '例如："帮我看看这个项目的文件结构" 或 "创建一个 utils.ts 并在里面写一个冒泡排序"',
      validate: (value: string) => {
        if (!value.trim()) return '指令不能为空，请输入点什么吧！';
      },
    });

    if (isCancel(result)) return null;

    const command = (result as string).trim();
    if (command.toLowerCase() === 'exit' || command.toLowerCase() === 'quit') return null;

    return command;
  },

  onUserInput(input: string, sourcePlugin: string): void {
    if (sourcePlugin === 'repl') return;
    const preview = input.length > 10 ? input.slice(0, 10) + '…' : input;
    console.log(`  [来自 ${sourcePlugin}] >> ${preview}`);
  },

  onStatus(event: StatusEvent): void {
    console.log(p(event.agentName, event.message));
  },

  onStreamChunk(event: StreamEvent): void {
    if (!event.text) return;
    if (isMainAgent(event.agentName)) {
      process.stdout.write(event.text);
    } else {
      const prefixed = event.text.split('\n').map(l => p(event.agentName, l)).join('\n');
      process.stdout.write(prefixed);
    }
  },

  onToolCall(event: ToolCallEvent): void {
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
    console.log(p(event.agentName, event.data));
  },
};
