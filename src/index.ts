import { NanoCodeAgent } from './agent.js';
import { PluginRegistry, registerBuiltinPlugin } from './plugin.js';
import { loadConfig, applyProfile, getSystemWhitelist } from './config.js';
import { LLMClient } from './llm.js';
import { buildMCPPluginsFromConfig } from './plugins/mcp/adapter.js';
import { npmLoaderPlugin } from './plugins/npm-loader.js';
import { loadSession, saveSession } from './session.js';
import { handlePluginCommand, printPluginList } from './plugin-cli.js';
import { loadAgentDefinitions } from './agent-loader.js';
import { createAgentToolPlugin } from './agent-tool.js';
import { createSkillsPlugin } from './plugins/skills/index.js';
import { registerAllDefaultBundledSkills, unregisterBundledSkill } from './plugins/skills/bundled/index.js';
import { createCommandsPlugin, setCommandAgent } from './plugins/commands/index.js';
import { createSkillsSlashPlugin } from './plugins/commands/skills-slash.js';
import { createAgentSlashPlugin, setTargetAgent } from './plugins/commands/agent-slash.js';
import { createBangPlugin } from './plugins/commands/bang.js';
import { taskPlanPlugin } from './plugins/tools/task-plan.js';
import { DisplayManager } from './display.js';
import { replDisplay } from './plugins/display/repl.js';
import { cliDisplay } from './plugins/display/cli.js';
import { resolveDisplayPlugin } from './plugins/display/loader.js';
import { SK } from './store-keys.js';
import { cac } from 'cac';
import { getPackageVersion } from './version.js';
import { logManager } from './logger.js';
import { runDoctor, formatDoctorResults } from './doctor.js';

// ── CLI messages ──

const EXIT_MESSAGE = '** 感谢使用 nano-code，祝您编码愉快！';
const MSG_DEBUG_MODE = (model: string | undefined) => `#  当前已开启 [DEBUG 调试模式]，模型: ${model}`;
const MSG_THINK_MODE = ' <-> 当前已开启 [思考过程显示]，将输出 AI 思考过程。';
const MSG_SKIP_PERMISSION = ' [!] 当前已开启 [免确认模式]，系统底层安全拦截仍然生效。';
const MSG_SESSION_RESTORED = (count: number, updatedAt: string) => `   ↻ 已恢复上次会话 (${count} 条消息，最后更新 ${updatedAt})\n`;
const MSG_SESSION_NOT_FOUND = '   - 未找到之前保存的会话，开始新的对话。\n';
const MSG_TOP_LEVEL_ERROR = (error: unknown) => `nano-code 遇到意外错误：${error instanceof Error ? error.message : String(error)}。可运行 /doctor 诊断。`;
const MSG_LLM_INIT_ERROR = 'X 错误: 无法初始化 AI 客户端。请检查 API Key 和 API 地址配置。';
const GREETING_WITH_TOOLS = '我可以帮您查看项目结构、读取代码并直接修改。';
const GREETING_NO_TOOLS = '我可以帮您解答编程问题，提供代码示例和建议。';

// ── Global error boundaries ──

function setupGlobalErrorHandlers(displayMgr?: DisplayManager, registry?: PluginRegistry): void {
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logManager.error('main', 'Unhandled Promise rejection', reason instanceof Error ? reason : new Error(message));
    displayMgr?.onError({ message: `未处理的 Promise 拒绝：${message}`, agentName: 'system', stack: reason instanceof Error ? reason.stack : undefined });
  });

  process.on('uncaughtException', (error) => {
    logManager.error('main', 'Uncaught exception', error);
    displayMgr?.onError({ message: `未捕获的异常：${error.message}`, agentName: 'system', stack: error.stack });
    registry?.destroy().finally(() => {
      displayMgr?.stop(EXIT_MESSAGE);
      process.exit(1);
    });
  });
}

async function handleExit(displayMgr?: DisplayManager, registry?: PluginRegistry): Promise<void> {
  await registry?.destroy();
  displayMgr?.stop(EXIT_MESSAGE);
  process.exit(0);
}

// ── Helper: create and populate the plugin registry ──

async function initializePlugins(
  config: ReturnType<typeof loadConfig>,
  registry: PluginRegistry,
  llmClient: LLMClient,
  displayMgr: DisplayManager,
  skipPermission: boolean,
): Promise<void> {
  registry.setAgentName('main');
  registry.setDefaultContext({
    skipPermission: skipPermission ?? false,
    defaultTimeout: config.core.defaultTimeout,
  });

  const npmEntries: Record<string, { spec?: string; enabled?: boolean }> = {};
  const systemWhitelist = getSystemWhitelist(config);

  // 预注入运行时引用到 token-budget 配置（自动压缩需要 llmClient + displayMgr），
  // 使其在 onInit 阶段可读。同时适用于 config.plugins 和 systemWhitelist 两个注册路径。
  const tbSettings = config.plugins['token-budget']?.settings;
  registry.setPluginConfig('token-budget', { ...(tbSettings ?? {}), llmClient, displayMgr });

  for (const [name, pluginCfg] of Object.entries(config.plugins)) {
    if (pluginCfg.enabled === false) continue;

    if (pluginCfg.settings && name !== 'token-budget') registry.setPluginConfig(name, pluginCfg.settings);

    if (pluginCfg.type === 'npm') {
      npmEntries[name] = { spec: pluginCfg.spec, enabled: pluginCfg.enabled };
    } else if (pluginCfg.type === 'mcp') {
      continue;
    } else {
      await registerBuiltinPlugin(registry, name, pluginCfg.settings);
    }
  }

  for (const mcpPlugin of buildMCPPluginsFromConfig(config)) {
    await registry.register(mcpPlugin);
  }

  registry.setPluginConfig('npm-loader', npmEntries);
  await registry.register(npmLoaderPlugin);

  for (const name of systemWhitelist) {
    if (config.plugins[name]) continue;
    await registerBuiltinPlugin(registry, name);
  }

  registerAllDefaultBundledSkills();
  const disabledSkills = config.skills?.disabled ?? [];
  for (const name of disabledSkills) unregisterBundledSkill(name);

  await registry.register(createSkillsPlugin(llmClient, displayMgr, {
    disabled: disabledSkills,
    disableSkillTool: config.skills?.disableSkillTool ?? false,
  }));

  for (const def of loadAgentDefinitions()) {
    if (def.enabled === false) continue;
    await registry.register(createAgentToolPlugin(def, llmClient, displayMgr));
  }

  await registry.register(createCommandsPlugin(displayMgr, registry, config));
  await registry.register(createAgentSlashPlugin(displayMgr));
  await registry.register(createSkillsSlashPlugin(llmClient, displayMgr));
  await registry.register(createBangPlugin(displayMgr));
  await registry.register(taskPlanPlugin);

  // 懒加载 skills-bridge（位于 Ink 目录下，其依赖为可选）
  try {
    const { initCommandSuggestions } = await import('./plugins/display/claude-code-ink/skills-bridge.js');
    initCommandSuggestions(disabledSkills);
  } catch {
    // Ink 可选依赖未安装时静默跳过
  }
  await displayMgr.init(registry);
}

// ── Helper: restore previous session ──

async function restoreSession(
  agent: NanoCodeAgent,
  registry: PluginRegistry,
  displayMgr: DisplayManager,
): Promise<void> {
  const session = loadSession(process.cwd());
  if (!session) {
    displayMgr.onStatus({ message: MSG_SESSION_NOT_FOUND, agentName: 'main', level: 'info' });
    return;
  }

  agent.loadHistory(session.messages);

  const { countMessagesTokens } = await import('./plugins/token-budget/counter.js');
  registry.store.set(SK.TokenBudgetInitialAccumulated, countMessagesTokens(session.messages));

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      displayMgr.onUserInput(msg.content ?? '', 'system');
    } else if (msg.role === 'assistant') {
      const text = msg.content ?? '';
      if (text) displayMgr.onStreamChunk({ text, agentName: 'main' });
    }
  }
  displayMgr.onStatus({ message: MSG_SESSION_RESTORED(session.messages.length, session.updatedAt), agentName: 'main', level: 'info' });
}

// ── Main interaction loop ──

async function runMainLoop(
  agent: NanoCodeAgent,
  registry: PluginRegistry,
  llmClient: LLMClient,
  displayMgr: DisplayManager,
): Promise<void> {
  // Signal handlers: at prompt → exit; during execution → cancel
  let isPrompting = false;
  const cancelHandler = () => {
    if (!isPrompting) {
      registry.store.set(SK.AgentCancelled, true);
      const abortCtrl = registry.store.get<AbortController>(SK.AgentAbort);
      if (abortCtrl && !abortCtrl.signal.aborted) abortCtrl.abort();
    }
    // At prompt: SIGINT is ignored — clack's text() or Ink's useInput handles \x03 directly
  };
  process.on('SIGINT', cancelHandler);
  process.on('SIGTERM', cancelHandler);

  while (true) {
    isPrompting = true;
    const userInput = await displayMgr.prompt();
    isPrompting = false;
    if (userInput === null) {
      await handleExit(displayMgr, registry);
      return;
    }

    const intercept = await registry.execBeforeAgentInput(userInput);
    if (intercept) {
      if (intercept.exit) {
        await handleExit(displayMgr, registry);
        return;
      }
      if (intercept.message) displayMgr.onStatus({ message: intercept.message, agentName: 'main', level: 'info' });
      if (intercept.injectMessages) agent.injectMessages(intercept.injectMessages);
      if (intercept.skipAgent) continue;
    }

    try {
      await agent.runTask(intercept?.replaceInput ?? userInput);
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message === 'CANCELLED') {
        registry.store.set(SK.AgentCancelled, undefined);
        continue;
      }
      displayMgr.onError({
        message: MSG_TOP_LEVEL_ERROR(error),
        agentName: 'main',
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      registry.store.set(SK.AgentCancelled, undefined);
      saveSession(process.cwd(), agent.getHistory());
    }
  }
}

async function startCLI(options: { debug?: boolean; think?: boolean; skipPermission?: boolean; listPlugins?: boolean; continue?: boolean; profile?: string }) {

  // ── Load configuration + optional agent profile ──
  const config = options.profile
    ? applyProfile(loadConfig(), options.profile)
    : loadConfig();

  // ── Load display plugin ──
  const displayMgr = new DisplayManager();
  if (config.display?.enabled === false) {
    displayMgr.addPlugin(config.display.plugin
      ? (await resolveDisplayPlugin(config.display.plugin)) ?? cliDisplay
      : cliDisplay);
  } else if (config.display?.plugin) {
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
  let llmClient: LLMClient;
  try {
    llmClient = new LLMClient({
      model: config.core.model,
      temperature: config.core.temperature,
      apiKey: config.core.apiKey,
      baseURL: config.core.baseURL,
    });
  } catch (err: any) {
    console.error(MSG_LLM_INIT_ERROR, err.message);
    process.exit(1);
  }

  // ── Plugin registry & initialization ──
  const registry = new PluginRegistry();
  await initializePlugins(config, registry, llmClient, displayMgr, options.skipPermission ?? false);

  // 全局错误边界（registry + display 就绪后注册）
  setupGlobalErrorHandlers(displayMgr, registry);

  // 注册 display bridge LogPlugin：将 Warn/Error 级别日志转发到界面显示
  logManager.register({
    name: 'display-bridge',
    onLog(entry) {
      if (entry.level === 'error') {
        displayMgr.onError({ message: `[${entry.module}] ${entry.message}`, agentName: 'system', stack: entry.error?.stack });
      }
    },
  });

  // ── --list-plugins mode: print and exit ──
  if (options.listPlugins) {
    printPluginList(registry);
    return;
  }

  // ── Determine agent identity and start display ──
  const hasTools = registry.getAllSchemas().length > 0;
  const greeting = config.agent?.greeting || (hasTools ? GREETING_WITH_TOOLS : GREETING_NO_TOOLS);

  displayMgr.start({
    greeting,
    agentName: 'main',
    profileName: options.profile,
    hasTools,
    showThink: options.think,
    debug: options.debug,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
  });

  if (options.debug) displayMgr.onStatus({ message: MSG_DEBUG_MODE(config.core.model), agentName: 'main', level: 'info' });
  else if (options.think) displayMgr.onStatus({ message: MSG_THINK_MODE, agentName: 'main', level: 'info' });
  if (options.skipPermission) displayMgr.onStatus({ message: MSG_SKIP_PERMISSION, agentName: 'main', level: 'info' });

  const agent = new NanoCodeAgent({ registry, llmClient, agentRole: config.agent?.role, promptConfig: config.systemPrompt, name: 'main', display: displayMgr });
  setCommandAgent(agent);
  setTargetAgent(agent, displayMgr);

  // ── Session restore ──
  if (options.continue) await restoreSession(agent, registry, displayMgr);

  // ── Main loop ──
  await runMainLoop(agent, registry, llmClient, displayMgr);
}

// ==========================================

// ==========================================
// 使用 cac 构建参数解析
// ==========================================
const cli = cac('nano-code');

cli.option('-d, --debug', '开启调试模式，输出大模型交互的原始数据包');
cli.option('-t, --think', '显示大模型的思考过程');
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

if (parsed.args[0] === 'doctor') {
  const cfg = loadConfig();
  let doctorLlm: LLMClient | undefined;
  try {
    doctorLlm = new LLMClient({
      model: cfg.core.model, temperature: cfg.core.temperature,
      apiKey: cfg.core.apiKey, baseURL: cfg.core.baseURL,
    });
  } catch { /* API Key 未配置时跳过连通性检查 */ }
  const results = await runDoctor(cfg, undefined, doctorLlm);
  process.stdout.write(formatDoctorResults(results));
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
