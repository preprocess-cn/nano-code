import { intro, text, outro, isCancel } from '@clack/prompts';
import { NanoCodeAgent } from './agent.js';
import { PluginRegistry } from './plugin.js';
import { loadConfig } from './config.js';
import { LLMClient } from './llm.js';
import { buildMCPPluginsFromConfig } from './plugins/mcp/adapter.js';
import { createTokenBudgetPlugin } from './plugins/token-budget.js';
import { loadSession, saveSession } from './session.js';
import { printPluginList } from './display.js';
import { cac } from 'cac';
import { getPackageVersion } from './version.js';

/**
 * Builtin plugin lazy-loaders.
 * Only loaded from disk when explicitly listed in the user's config.
 */
const BUILTIN_PLUGINS: Record<string, () => Promise<any>> = {
  fs: () => import('./plugins/tools/fs.js').then(m => m.fsPlugin),
  command: () => import('./plugins/tools/command.js').then(m => m.commandPlugin),
};

function handleExit() {
  outro('** 感谢使用 nano-code，祝您编码愉快！');
  process.exit(0);
}

async function startCLI(options: { debug?: boolean; think?: boolean; skipPermission?: boolean; listPlugins?: boolean; continue?: boolean }) {

  console.log('\n');
  intro('! nano-code 终端 AI 编程助手 启动中...');

  // ── Load configuration ──
  const config = loadConfig();

  if(options.debug) {
    console.log(`#  当前已开启 [DEBUG 调试模式]，模型: ${config.core.model}`);
  }
  if (options.think && !options.debug) {
    console.log(' <-> 当前已开启 [思维链显示]，将输出 AI 思考过程。');
  }
  if (options.skipPermission) {
    console.log(' [!] 当前已开启 [免确认模式]，系统底层安全拦截仍然生效。');
  }

  // ── LLM Client ──
  const llmClient = new LLMClient({
    model: config.core.model,
    temperature: config.core.temperature,
  });

  // ── Plugin registry ──
  const registry = new PluginRegistry();
  registry.setDefaultContext({
    skipPermission: options.skipPermission ?? false,
    defaultTimeout: config.core.defaultTimeout,
  });

  // Load plugin configs from user config into registry
  for (const [name, pluginCfg] of Object.entries(config.plugins)) {
    if (pluginCfg.settings) {
      registry.setPluginConfig(name, pluginCfg.settings);
    }
  }

  // Register builtin plugins from config
  for (const [name, pluginCfg] of Object.entries(config.plugins)) {
    if (pluginCfg.enabled === false) continue;
    const loader = BUILTIN_PLUGINS[name];
    if (loader) {
      await registry.register(await loader());
    }
  }

  // Register MCP plugins from config
  for (const mcpPlugin of buildMCPPluginsFromConfig(config)) {
    await registry.register(mcpPlugin);
  }

  // Register token-budget plugin if configured
  if (config.plugins['token-budget']) {
    const budgetConfig = config.plugins['token-budget'].settings || {};
    await registry.register(createTokenBudgetPlugin(budgetConfig));
  }

  // ── --list-plugins mode: print and exit ──
  if (options.listPlugins) {
    printPluginList(registry);
    return;
  }

  // ── Determine agent identity and show greeting ──
  const hasTools = registry.getAllSchemas().length > 0;
  const defaultGreeting = hasTools
    ? '我可以帮您查看项目结构、读取代码并直接修改。'
    : '我可以帮您解答编程问题，提供代码示例和建议。';
  const greeting = config.agent?.greeting || defaultGreeting;

  console.log('----------------------------------------------------');
  console.log(` * 提示：${greeting}`);
  console.log(' [!] 退出：输入 "exit"、"quit" 或直接按下 Ctrl+C 即可。');
  console.log('----------------------------------------------------\n');

  const agent = new NanoCodeAgent(registry, options.debug, options.think, llmClient, config.agent?.role);

  // ── --continue: restore previous session ──
  if (options.continue) {
    const session = loadSession(process.cwd());
    if (session) {
      agent.loadHistory(session.messages);
      console.log(`   ↻ 已恢复上次会话 (${session.messages.length} 条消息，最后更新 ${session.updatedAt})\n`);
    } else {
      console.log('   - 未找到之前保存的会话，开始新的对话。\n');
    }
  }

  // 3. 进入无限交互循环
  while (true) {
    const userPrompt = await text({
      message: '>>  请输入开发任务或指令：',
      placeholder: '例如："帮我看看这个项目的文件结构" 或 "创建一个 utils.ts 并在里面写一个冒泡排序"',
      validate: (value) => {
        if (!value.trim()) return '指令不能为空，请输入点什么吧！';
      },
    });

    if (isCancel(userPrompt)) {
      handleExit();
    }

    const command = (userPrompt as string).trim();

    if (command.toLowerCase() === 'exit' || command.toLowerCase() === 'quit') {
      handleExit();
    }

    try {
      await agent.runTask(command);
    } catch (error) {
      console.error('X 顶层循环捕获到未处理的致命异常:');
      console.error(error);
      console.log('\n');
    } finally {
      saveSession(process.cwd(), agent.getHistory());
    }
  }
}

// ==========================================
// 使用 cac 构建参数解析
// ==========================================
const cli = cac('nano-code');

cli.option('-d, --debug', '开启调试模式，输出大模型交互的原始数据包');
cli.option('-t, --think', '显示大模型的思考过程（思维链）');
cli.option('--skip-permission', '跳过工具调用的用户确认提示，系统底层安全拦截仍然生效');
cli.option('--list-plugins', '列出所有已注册的插件及其提供的工具');
cli.option('-c, --continue', '接续最近一次在当前项目中的会话继续对话');

cli.help();
cli.version(getPackageVersion());

const parsed = cli.parse();

if (!parsed.options.help && !parsed.options.version) {
  const showThink = !!(parsed.options.think || parsed.options.debug);
  startCLI({
    debug: parsed.options.debug,
    think: showThink,
    skipPermission: parsed.options.skipPermission,
    listPlugins: parsed.options.listPlugins ?? false,
    continue: parsed.options.continue ?? false,
  });
}
