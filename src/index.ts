import { NanoCodeAgent } from './agent.js';
import { PluginRegistry, registerBuiltinPlugin } from './plugin.js';
import { loadConfig, applyProfile, getSystemWhitelist } from './config.js';
import { LLMClient } from './llm.js';
import { buildMCPPluginsFromConfig } from './plugins/mcp/adapter.js';
import { npmLoaderPlugin } from './plugins/npm-loader.js';
import { loadSession, saveSession } from './session.js';
import { printPluginList } from './display.js';
import { handlePluginCommand } from './plugin-cli.js';
import { loadAgentDefinitions } from './agent-loader.js';
import { createAgentToolPlugin } from './agent-tool.js';
import { DisplayManager } from './display.js';
import { replDisplay } from './plugins/display/repl.js';
import { resolveDisplayPlugin } from './plugins/display/loader.js';
import { cac } from 'cac';
import { getPackageVersion } from './version.js';

function handleExit(display?: DisplayManager): never {
  display?.stop('** 感谢使用 nano-code，祝您编码愉快！');
  process.exit(0);
}

async function startCLI(options: { debug?: boolean; think?: boolean; skipPermission?: boolean; listPlugins?: boolean; continue?: boolean; profile?: string }) {

  // ── Load configuration + optional agent profile ──
  const config = options.profile
    ? applyProfile(loadConfig(), options.profile)
    : loadConfig();

  // ── Validate display config ──
  const dispCfg = config.display;
  if (dispCfg?.enabled === false && !dispCfg.plugin) {
    console.error('[FATAL] 展示层已被禁用且未指定替代插件。展示层必须存在。');
    console.error('        请在配置中设置 display.plugin 或移除 display.enabled=false。');
    process.exit(1);
  }

  // ── Load display plugin ──
  const displayMgr = new DisplayManager();
  if (config.display?.plugin) {
    try {
      const plugin = await resolveDisplayPlugin(config.display.plugin);
      displayMgr.addPlugin(plugin ?? replDisplay);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  } else {
    displayMgr.addPlugin(replDisplay);
  }

  // ── LLM Client ──
  const llmClient = new LLMClient({
    model: config.core.model,
    temperature: config.core.temperature,
    apiKey: config.core.apiKey,
    baseURL: config.core.baseURL,
  });

  // ── Plugin registry ──
  const registry = new PluginRegistry();
  registry.setAgentName('main');
  registry.setDefaultContext({
    skipPermission: options.skipPermission ?? false,
    defaultTimeout: config.core.defaultTimeout,
  });

  // ── 插件注册：统一遍历 config.plugins ──
  const npmEntries: Record<string, { spec?: string; enabled?: boolean }> = {};
  const systemWhitelist = getSystemWhitelist(config);

  for (const [name, pluginCfg] of Object.entries(config.plugins)) {
    if (pluginCfg.enabled === false) continue;

    // 1) 将 settings 存入 registry（供插件 onInit 读取）
    if (pluginCfg.settings) {
      registry.setPluginConfig(name, pluginCfg.settings);
    }

    // 2) 根据类型分发注册
    if (pluginCfg.type === 'npm') {
      npmEntries[name] = { spec: pluginCfg.spec, enabled: pluginCfg.enabled };
    } else if (pluginCfg.type === 'mcp') {
      // MCP 插件由 buildMCPPluginsFromConfig 统一处理，此处跳过
      continue;
    } else {
      await registerBuiltinPlugin(registry, name, pluginCfg.settings);
    }
  }

  // 注册 MCP 插件（统一批量处理）
  for (const mcpPlugin of buildMCPPluginsFromConfig(config)) {
    await registry.register(mcpPlugin);
  }

  // 注册 npm-loader（收集的 npm 条目作为配置传入）
  registry.setPluginConfig('npm-loader', npmEntries);
  await registry.register(npmLoaderPlugin);

  // 自动加载系统插件中未在配置中出现的条目（白名单默认启用）
  for (const name of systemWhitelist) {
    if (config.plugins[name]) continue;
    await registerBuiltinPlugin(registry, name);
  }

  // ── 自动发现并注册 agent 工具 ──
  const agentDefs = loadAgentDefinitions();
  for (const def of agentDefs) {
    if (def.enabled === false) continue;
    const plugin = createAgentToolPlugin(def, llmClient, displayMgr);
    await registry.register(plugin);
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

  displayMgr.start({
    greeting,
    agentName: 'main',
    profileName: options.profile,
    hasTools,
    showThink: options.think,
    debug: options.debug,
  });

  if(options.debug) {
    displayMgr.onStatus({ message: `#  当前已开启 [DEBUG 调试模式]，模型: ${config.core.model}`, agentName: 'main' });
  }
  if (options.think && !options.debug) {
    displayMgr.onStatus({ message: ' <-> 当前已开启 [思维链显示]，将输出 AI 思考过程。', agentName: 'main' });
  }
  if (options.skipPermission) {
    displayMgr.onStatus({ message: ' [!] 当前已开启 [免确认模式]，系统底层安全拦截仍然生效。', agentName: 'main' });
  }

  const agent = new NanoCodeAgent(registry, llmClient, config.agent?.role, config.systemPrompt, 'main', displayMgr);

  // ── --continue: restore previous session ──
  if (options.continue) {
    const session = loadSession(process.cwd());
    if (session) {
      agent.loadHistory(session.messages);
      displayMgr.onStatus({ message: `   ↻ 已恢复上次会话 (${session.messages.length} 条消息，最后更新 ${session.updatedAt})\n`, agentName: 'main' });
    } else {
      displayMgr.onStatus({ message: '   - 未找到之前保存的会话，开始新的对话。\n', agentName: 'main' });
    }
  }

  // 3. 进入无限交互循环
  while (true) {
    const userPrompt = await displayMgr.prompt();
    if (userPrompt === null) {
      handleExit(displayMgr);
    }

    try {
      await agent.runTask(userPrompt);
    } catch (error) {
      displayMgr.onError({ message: `X 顶层循环捕获到未处理的致命异常: ${error}`, agentName: 'main', stack: error instanceof Error ? error.stack : undefined });
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
cli.option('-p, --profile <name>', '指定 agent 角色配置文件（profile），可以是名称（如 treehole）或文件路径（如 ./my-profile.json）');

cli.help();
cli.version(getPackageVersion());

const parsed = cli.parse();

if (parsed.args[0] === 'plugin') {
  await handlePluginCommand(parsed.args.slice(1), parsed.options);
  process.exit(0);
}

if (!parsed.options.help && !parsed.options.version) {
  const showThink = !!(parsed.options.think || parsed.options.debug);
  startCLI({
    debug: parsed.options.debug,
    think: showThink,
    skipPermission: parsed.options.skipPermission,
    listPlugins: parsed.options.listPlugins ?? false,
    continue: parsed.options.continue ?? false,
    profile: parsed.options.profile as string | undefined,
  });
}
