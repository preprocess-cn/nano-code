import { CommandInterceptResult, type InjectedMessage } from '#src/core/contract.js';
import { NanoCodeAgent } from '#src/core/agent.js';
import { PluginRegistry } from '#src/core/plugin.js';
import { loadConfig, NanoConfig, getSystemWhitelist } from '#src/core/config.js';
import { DisplayManager } from '#src/display.js';
import { loadAllSkills } from '#src/plugins/skills/loader.js';
import { analyzeContextUsage, type ContextAnalysis } from '#src/plugins/token-budget/analyzer.js';
import { CompactService } from '#src/plugins/compact/service.js';
import { saveSession } from '#src/core/session.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { BuiltinCommand } from '#src/plugins/commands/types.js';
import { readAllTasks, getPlanFilePath } from '#src/plugins/tools/task-plan.js';
import { SK } from '#src/core/store-keys.js';
import type { ModelEntry } from '#src/core/llm.js';
import { runDoctor, formatDoctorResults } from '#src/core/doctor.js';
import { loadAgentDefinitions } from '#src/plugins/coordinator/agent-loader.js';
import { readMcpJson, getProjectMcpJsonPath, getGlobalMcpJsonPath, getClaudeMcpJsonPath } from '#src/plugins/mcp/config-writer.js';
import { CronScheduler } from '#src/plugins/cron/cron-scheduler.js';

export interface BuiltinContext {
  agent: NanoCodeAgent;
  registry: PluginRegistry;
  config: NanoConfig;
  display?: DisplayManager;
  /** 命令后的参数字符串 */
  args?: string;
}

const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: 'exit',
    aliases: ['quit'],
    description: '退出程序',
    handler: async () => ({ handled: true, exit: true } as CommandInterceptResult),
  },
  {
    name: 'clear',
    aliases: ['new'],
    description: '清除当前对话历史，重新开始',
    handler: async () => ({ handled: true, skipAgent: true, message: '已清除对话历史，重新开始' } as CommandInterceptResult),
  },
  {
    name: 'help',
    description: '显示此帮助信息',
    handler: async () => {
      const lines: string[] = [];
      lines.push('');
      lines.push('内建斜杠命令：');
      lines.push('  /exit, /quit      退出程序');
      lines.push('  /clear            清除当前对话，重新开始');
      lines.push('  /help             显示此帮助信息');
      lines.push('  /compact          压缩对话历史，节省上下文空间');
      lines.push('  /context          查看上下文分布及用量');
      lines.push('  /plan             查看/管理 Plan Mode');
      lines.push('  /task, /tasks     查看任务列表');
      lines.push('  /doctor           诊断系统健康状态');
      lines.push('  /model [name]      查看/切换 LLM 模型（需启用 model-registry 插件）');
      lines.push('  /plugin, /plugins 管理插件 — /plugin list, enable <name>, disable <name>');
      lines.push('  /init            初始化 AGENT.md — 分析项目结构并生成代码库文档');
      lines.push('');

      const skills = loadAllSkills();
      if (skills.length > 0) {
        lines.push('可用技能（输入 /<技能名> 直接调用）：');
        for (const s of skills) {
          lines.push(`  /${s.name.padEnd(20)} ${s.description}`);
        }
        lines.push('');
      }

      lines.push('Git 命令：');
      lines.push('  /diff [args]     查看工作区 git diff（直接透传 git diff 参数）');
      lines.push('  /status [args]   查看工作区变更状态（直接透传 git status 参数）');
      lines.push('');
      lines.push('定时任务：');
      lines.push('  /loop [间隔] <prompt>  创建定时循环任务（如 /loop 5m "检查部署"）');
      lines.push('');

      lines.push('可直接执行的 bash 命令（输入 !<命令>）：');
      lines.push('  !ls -la            直接执行 ls -la');
      lines.push('  !npm test          直接运行测试');
      lines.push('');

      return { handled: true, skipAgent: true, message: lines.join('\n') };
    },
  },
  // ── /diff ──
  {
    name: 'diff',
    description: '查看工作区 git diff — /diff [--staged] [--stat] [<path>]（直接透传参数给 git diff）',
    handler: async (ctx?: BuiltinContext) => {
      const args = (ctx?.args || '').trim();
      try {
        const output = execSync(`git diff ${args}`, { encoding: 'utf-8', cwd: process.cwd() });
        if (!output) return { handled: true, skipAgent: true, message: '工作区干净，无未暂存的变更。' };
        return { handled: true, skipAgent: true, message: output };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, skipAgent: true, message: `git diff 执行失败: ${msg}` };
      }
    },
  },
  // ── /status ──
  {
    name: 'status',
    description: '查看工作区变更状态 — /status [-b] [--long]（直接透传参数给 git status）',
    handler: async (ctx?: BuiltinContext) => {
      const args = (ctx?.args || '').trim();
      const defaultArgs = args || '--short';
      try {
        const output = execSync(`git status ${defaultArgs}`, { encoding: 'utf-8', cwd: process.cwd() });
        return { handled: true, skipAgent: true, message: output || '工作区干净。' };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, skipAgent: true, message: `git status 执行失败: ${msg}` };
      }
    },
  },
  // ── /loop ──
  {
    name: 'loop',
    description: '创建定时循环任务 — /loop [间隔] <prompt>（如 /loop 5m "检查部署"）',
    handler: async (ctx?: BuiltinContext) => {
      const args = (ctx?.args || '').trim();
      if (!args) {
        return {
          handled: true, skipAgent: true,
          message: [
            '',
            '用法: /loop [间隔] <prompt>',
            '',
            '间隔格式（选填，不指定则 LLM 自定速）：',
            '  30s      每 30 秒',
            '  5m       每 5 分钟',
            '  1h       每小时',
            '  */5 * * * *  标准 cron 表达式',
            '',
            '示例:',
            '  /loop 5m 检查服务器状态',
            '  /loop 1h "运行测试套件"',
            '  /loop */5 * * * * 执行定时任务',
            '',
            '管理：使用 cron_list / cron_delete 工具在对话中管理任务。',
            '',
          ].join('\n'),
        };
      }

      const parsed = parseLoopArgs(args);
      if (!parsed) {
        return { handled: true, skipAgent: true, message: '参数解析失败。间隔格式: 30s, 5m, 1h 或标准 cron 表达式。' };
      }

      const scheduler = CronScheduler.getInstance();
      scheduler.initialize();

      const result = scheduler.createTask({
        cron: parsed.cron,
        prompt: parsed.prompt,
        description: parsed.humanReadable,
        recurring: true,
        durable: false,
      });

      if ('error' in result) {
        return { handled: true, skipAgent: true, message: `创建定时任务失败: ${result.error}` };
      }

      return {
        handled: true, skipAgent: true,
        message: `已创建定时任务 #${result.id}
  触发间隔: ${parsed.humanReadable}
  执行内容: ${parsed.prompt}
  任务 ID: ${result.id}

使用 cron_delete({ id: "${result.id}" }) 在对话中删除此任务。`,
      };
    },
  },
  {
    name: 'compact',
    aliases: ['compress'],
    description: '压缩对话历史 — 保留最近对话，摘要旧消息以节省上下文空间',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.agent || !ctx?.registry || !ctx?.config) {
        return { handled: true, skipAgent: true, message: '无法获取上下文信息' };
      }
      const llmClient = ctx.agent.getLLMClient();
      if (!llmClient) {
        return { handled: true, skipAgent: true, message: '无法获取 LLM 客户端' };
      }

      const args = (ctx.args || '').trim();
      const options: { preserveCount?: number; dryRun?: boolean; summaryModel?: string; customInstructions?: string } = {};

      // 基于 token 的解析，避免 regex 相邻 flag 吞并问题
      const tokens = args.match(/(?:--\S+(?:\s+\S+)?|\S+)/g) || [];
      const positional: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('--preserve') && tokens[i + 1] && !tokens[i + 1].startsWith('--')) {
          options.preserveCount = parseInt(tokens[++i], 10);
        } else if (t === '--dry-run') {
          options.dryRun = true;
        } else if (t.startsWith('--model') && tokens[i + 1] && !tokens[i + 1].startsWith('--')) {
          options.summaryModel = tokens[++i];
        } else if (t.startsWith('--model=')) {
          options.summaryModel = t.slice('--model='.length);
        } else if (!t.startsWith('--')) {
          positional.push(t);
        }
      }
      const cleanArgs = positional.join(' ');
      if (cleanArgs) options.customInstructions = cleanArgs;

      // 清理自动压缩信号（手动 /compact 后不再触发自动压缩）
      ctx.registry.store.set(SK.CompactSignal, false);

      const service = new CompactService(llmClient, ctx.registry, ctx.display);

      try {
        if (!options.dryRun) {
          const backupPath = path.join(process.cwd(), '.nano-code-session.pre-compact.json');
          try {
            fs.writeFileSync(backupPath, JSON.stringify({
              messages: ctx.agent.getHistory(),
              updatedAt: new Date().toISOString(),
            }, null, 2), 'utf-8');
          } catch { /* best-effort */ }
        }

        const result = await service.compact(ctx.agent, options);

        if (options.dryRun) {
          const pct = result.originalTokens > 0
            ? ((result.savedTokens / result.originalTokens) * 100).toFixed(0) : '0';
          return {
            handled: true, skipAgent: true,
            message: [
              '',
              `  [Dry-Run] 压缩预览（未实际修改）`,
              `  ${result.originalMessageCount} 条 → ~${result.compactedMessageCount} 条消息`,
              `  ${(result.originalTokens / 1000).toFixed(1)}K → ~${(result.compactedTokens / 1000).toFixed(1)}K tokens`,
              `  预估节省 ~${(result.savedTokens / 1000).toFixed(1)}K tokens（${pct}%）`,
              `  将保留最近 ${options.preserveCount ?? 2} 组对话`,
              '',
            ].join('\n'),
          };
        }

        ctx.agent.loadHistory(result.messages);
        saveSession(process.cwd(), result.messages);

        const pct = result.originalTokens > 0
          ? ((result.savedTokens / result.originalTokens) * 100).toFixed(0) : '0';

        return {
          handled: true, skipAgent: true,
          message: [
            '',
            `  对话已压缩`,
            `  ${result.originalMessageCount} 条 → ${result.compactedMessageCount} 条消息`,
            `  ${(result.originalTokens / 1000).toFixed(1)}K → ${(result.compactedTokens / 1000).toFixed(1)}K tokens`,
            `  节省 ${(result.savedTokens / 1000).toFixed(1)}K tokens（${pct}%）`,
            `  备份已保存至 .nano-code-session.pre-compact.json`,
            '',
          ].join('\n'),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { handled: true, skipAgent: true, message: `压缩失败: ${msg}` };
      }
    },
  },
  {
    name: 'plan',
    description: '查看/管理 Plan Mode — /plan [open|exit]',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.registry) {
        return { handled: true, skipAgent: true, message: '无法获取上下文信息' };
      }
      const args = (ctx.args || '').trim();
      const store = ctx.registry.store;
      const mode = store.get<string>(SK.Mode) || 'normal';

      if (args === 'open') {
        const planPath = getPlanFilePath();
        return { handled: true, skipAgent: true, message: `计划文件路径: ${planPath}` };
      }

      if (args === 'exit') {
        store.set(SK.Mode, 'normal');
        return { handled: true, skipAgent: true, message: '已退出 Plan Mode，恢复为常规模式。' };
      }

      // Show plan content
      const planPath = getPlanFilePath();
      let planContent = '';
      try {
        planContent = fs.readFileSync(planPath, 'utf-8');
      } catch { /* no plan yet */ }

      const lines: string[] = [];
      lines.push('');
      const modeLabel = mode === 'plan' ? '\x1b[33m● plan mode\x1b[0m' : 'normal';
      lines.push(`  当前模式: ${modeLabel}`);
      lines.push(`  计划文件: ${planPath}`);
      if (planContent) {
        lines.push('');
        lines.push(`  当前计划内容:`);
        lines.push(`  ${planContent.split('\n').join('\n  ')}`);
      }
      lines.push('');
      lines.push('  /plan open    打开计划文件');
      lines.push('  /plan exit    退出 plan mode');
      lines.push('');
      return { handled: true, skipAgent: true, message: lines.join('\n') };
    },
  },
  {
    name: 'task',
    aliases: ['tasks'],
    description: '查看/管理任务列表 — /task list',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.registry) {
        return { handled: true, skipAgent: true, message: '无法获取上下文信息' };
      }
      const args = (ctx.args || '').trim();

      if (args === 'list' || !args) {
        const tasks = await readAllTasks();
        if (tasks.length === 0) {
          return { handled: true, skipAgent: true, message: '任务列表为空。' };
        }
        const lines = tasks.map(t =>
          `  #${t.id} [${t.status}] ${t.subject}${t.owner ? ` (${t.owner})` : ''}`,
        );
        return { handled: true, skipAgent: true, message: ['', `  共 ${tasks.length} 个任务:`, ...lines, ''].join('\n') };
      }

      // Show a single task
      const tasks = await readAllTasks();
      const task = tasks.find(t => t.id === args);
      if (!task) {
        return { handled: true, skipAgent: true, message: `任务 #${args} 未找到。` };
      }
      const lines: string[] = [];
      lines.push(`  任务 #${task.id}: ${task.subject}`);
      lines.push(`  状态: ${task.status}`);
      if (task.owner) lines.push(`  负责人: ${task.owner}`);
      lines.push(`  描述: ${task.description}`);
      if (task.blockedBy.length > 0) lines.push(`  阻塞于: ${task.blockedBy.map(id => `#${id}`).join(', ')}`);
      if (task.blocks.length > 0) lines.push(`  阻塞: ${task.blocks.map(id => `#${id}`).join(', ')}`);
      return { handled: true, skipAgent: true, message: ['', ...lines, ''].join('\n') };
    },
  },
  {
    name: 'permissions',
    description: '查看/管理会话权限 — /permissions [reset]',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.registry) {
        return { handled: true, skipAgent: true, message: '无法获取上下文信息' };
      }
      const args = (ctx.args || '').trim();
      if (args === 'reset') {
        ctx.registry.clearPermissions();
        return { handled: true, skipAgent: true, message: '会话权限 allowlist 已清空，工具将重新请求确认。' };
      }
      const allowed = ctx.registry.getAllowedTools();
      if (allowed.length === 0) {
        return { handled: true, skipAgent: true, message: '当前会话中没有已允许免确认的工具。' };
      }
      return {
        handled: true, skipAgent: true,
        message: ['', '当前会话已允许免确认的工具：', ...allowed.map(t => `  - ${t}`), '', '使用 /permissions reset 清空 allowlist。', ''].join('\n'),
      };
    },
  },
  {
    name: 'model',
    description: '查看/切换 LLM 模型 — /model [name|index]',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.registry) {
        return { handled: true, skipAgent: true, message: '无法获取上下文信息' };
      }
      const store = ctx.registry.store;
      const models = store.get<ModelEntry[]>(SK.ModelRegistryModels);

      if (!models || models.length === 0) {
        return { handled: true, skipAgent: true, message: '未配置模型注册表。请启用 model-registry 插件并配置 models。' };
      }

      const current = store.get<ModelEntry>(SK.ModelOverride);
      const args = (ctx.args || '').trim();

      // /model bare — try interactive picker first (Ink), fall back to text list
      if (!args) {
        if (ctx.display) {
          const handled = await ctx.display.showModelPicker(ctx.registry);
          if (handled) return { handled: true, skipAgent: true };
        }

        const lines: string[] = [''];
        lines.push('可用模型：');
        models.forEach((m, i) => {
          const label = m.provider ? `${m.provider}/${m.model}` : m.model;
          const active = current && m.model === current.model && m.apiKey === current.apiKey ? '  ← 当前' : '';
          lines.push(`  [${i}] ${label}${active}`);
        });
        lines.push('');
        lines.push('使用 /model <名称|序号> 切换模型');
        lines.push('');
        return { handled: true, skipAgent: true, message: lines.join('\n') };
      }

      // /model <index>
      const idx = parseInt(args, 10);
      if (!isNaN(idx) && idx >= 0 && idx < models.length) {
        const m = models[idx];
        store.set(SK.ModelOverride, m);
        return { handled: true, skipAgent: true, message: `已切换到模型: ${m.provider ? m.provider + '/' : ''}${m.model}` };
      }

      // /model <name> — match by model name or provider/model
      const match = models.find(m => m.model === args || (m.provider && `${m.provider}/${m.model}` === args));
      if (match) {
        store.set(SK.ModelOverride, match);
        return { handled: true, skipAgent: true, message: `已切换到模型: ${match.provider ? match.provider + '/' : ''}${match.model}` };
      }

      return { handled: true, skipAgent: true, message: `未找到模型 "${args}"。使用 /model 查看可用模型列表。` };
    },
  },
  {
    name: 'context',
    description: '查看上下文分布及用量',
    handler: async (ctx?: BuiltinContext) => {
      if (!ctx?.agent || !ctx?.registry || !ctx?.config) {
        console.log('无法获取上下文信息（缺少 agent/registry/config）');
        return { handled: true, skipAgent: true };
      }

      // Get API usage from token-budget plugin (priority 1)
      const getApiUsage = ctx.registry.store.get(SK.TokenBudgetGetApiUsage) as
        (() => { inputTokens: number; outputTokens: number; totalTokens: number }) | undefined;
      const apiTotalTokens = getApiUsage?.().totalTokens;

      const analysis = analyzeContextUsage(ctx.agent, ctx.registry, ctx.config, apiTotalTokens);

      // 推送结构化数据给展示层（Ink 渲染色块，REPL 无操作）
      ctx.display?.onContextAnalysis(analysis);

      const output = formatContextOutput(analysis);
      return { handled: true, skipAgent: true, message: output };
    },
  },
  {
    name: 'doctor',
    description: '诊断系统健康状态 — 检查配置、API 连通性、插件加载',
    handler: async (ctx?: BuiltinContext) => {
      let results;
      if (ctx?.registry) {
        const llmClient = ctx.agent?.getLLMClient();
        results = await runDoctor(ctx.config || { configVersion: 1, core: { maxTokens: 128000, defaultTimeout: 120000 }, plugins: {} }, ctx.registry, llmClient);
      } else {
        const { loadConfig } = await import('#src/core/config.js');
        results = await runDoctor(loadConfig(), undefined, undefined);
      }
      return { handled: true, skipAgent: true, message: formatDoctorResults(results) };
    },
  },
  {
    name: 'plugin',
    aliases: ['plugins'],
    description: '管理插件 — /plugin list, enable <name>, disable <name>',
    handler: async (ctx?: BuiltinContext) => {
      const args = (ctx?.args || '').trim();
      const registry = ctx?.registry;
      const config = ctx?.config;
      const display = ctx?.display;

      // 无参数或 /plugin manage → 尝试交互式管理
      if (!args || args === 'manage') {
        if (display) {
          const handled = await display.showPluginManager(registry!);
          if (handled) return { handled: true, skipAgent: true };
        }
        // fallback: 显示文本列表
        return buildPluginList(config);
      }

      // /plugin list
      if (args === 'list') {
        return buildPluginList(config);
      }

      // /plugin enable <name> 或 /plugin disable <name>
      const enableMatch = args.match(/^(enable|disable)\s+(.+)$/);
      if (enableMatch) {
        const enable = enableMatch[1] === 'enable';
        const name = enableMatch[2].trim();
        return togglePlugin(name, enable, config);
      }

      return { handled: true, skipAgent: true, message: `未知 plugin 子命令: ${args}。可用: list, enable <name>, disable <name>, manage` };
    },
  },
  {
    name: 'init',
    description: '初始化 AGENT.md — 分析项目并生成代码库文档',
    handler: async (ctx?: BuiltinContext) => {
      return {
        handled: true,
        injectMessages: [{
          role: 'user',
          content: INIT_PROMPT,
        }],
      };
    },
  },
];

export function getBuiltinCommands(): BuiltinCommand[] {
  return BUILTIN_COMMANDS;
}

export function findBuiltinCommand(name: string): BuiltinCommand | undefined {
  return BUILTIN_COMMANDS.find(
    cmd => cmd.name === name || cmd.aliases?.includes(name),
  );
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtPct(pct: number): string {
  return pct.toFixed(1);
}

function formatContextOutput(analysis: ContextAnalysis): string {
  const lines: string[] = [];
  lines.push('');

  // Header
  const usageLabel = analysis.usageSource === 'api' ? '（API 实际）' : '（估算）';
  lines.push(`  模型: ${analysis.modelName} · 上下文窗口: ${fmt(analysis.contextWindow)} tokens`);
  lines.push(`  ───────────────────────────────────────────────`);
  lines.push(`  上下文使用总量: ${fmt(analysis.totalTokens)} / ${fmt(analysis.contextWindow)} (${fmtPct(analysis.percentage)}%) ${usageLabel}`);
  lines.push('');

  // Each dimension
  for (const dim of analysis.dimensions) {
    const pctStr = dim.tokens > 0 ? fmtPct(dim.percentage) : '-';
    lines.push(`  ${dim.name.padEnd(20)} ${fmt(dim.tokens).padStart(10)} (${pctStr}%)`);
    for (const item of dim.items) {
      if (item.tokens === 0) continue;
      lines.push(`    ├─ ${item.name.padEnd(25)} ${fmt(item.tokens).padStart(8)}`);
    }
  }

  // Free space
  lines.push(`  ───────────────────────────────────────────────`);
  if (analysis.freeTokens > 0) {
    const freePct = ((analysis.freeTokens / analysis.contextWindow) * 100).toFixed(1);
    lines.push(`  Free Space${' '.repeat(13)} ${fmt(analysis.freeTokens).padStart(10)} (${freePct}%)`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── /plugin sub-commands ──

export interface PluginRow {
  name: string;
  status: string;
  tag: string;
}

export function collectPlugins(config: NanoConfig | undefined): PluginRow[] {
  const names = new Set<string>();
  const mcpJsonNames = new Set<string>();
  const claudeJsonNames = new Set<string>();

  // 已配置的插件
  if (config?.plugins) {
    for (const name of Object.keys(config.plugins)) names.add(name);
  }

  // 系统白名单
  if (config) {
    const whitelist = getSystemWhitelist(config);
    for (const w of whitelist) names.add(w);
  }

  // .mcp.json
  for (const f of [getProjectMcpJsonPath(), getGlobalMcpJsonPath()]) {
    const cfg = readMcpJson(f);
    if (cfg) for (const name of Object.keys(cfg.mcpServers)) { names.add(name); mcpJsonNames.add(name); }
  }
  const claudeCfg = readMcpJson(getClaudeMcpJsonPath());
  if (claudeCfg) {
    for (const name of Object.keys(claudeCfg.mcpServers)) {
      if (!mcpJsonNames.has(name)) { names.add(name); claudeJsonNames.add(name); }
    }
  }

  const whitelist = config ? getSystemWhitelist(config) : new Set<string>();
  const rows: PluginRow[] = [];
  for (const name of names) {
    const cfg = config?.plugins?.[name];
    const enabled = cfg ? cfg.enabled !== false : true;
    const tag = whitelist.has(name) ? 'system'
      : (cfg?.type || (mcpJsonNames.has(name) ? 'mcp'
        : (claudeJsonNames.has(name) ? 'claude' : 'user')));
    rows.push({ name, status: enabled ? 'active' : 'inactive', tag });
  }

  // agent 插件
  try {
    for (const def of loadAgentDefinitions()) {
      rows.push({
        name: `agent:${def.name}`,
        status: def.enabled !== false ? 'active' : 'inactive',
        tag: 'agent',
      });
    }
  } catch { /* 忽略加载失败 */ }

  rows.sort((a, b) => {
    const prio: Record<string, number> = { system: 0, agent: 1, user: 2, npm: 2, mcp: 2 };
    const pa = prio[a.tag] ?? 3;
    const pb = prio[b.tag] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

export function buildPluginList(config: NanoConfig | undefined): CommandInterceptResult {
  const rows = collectPlugins(config);
  const lines: string[] = [];
  lines.push('');
  lines.push(`  已安装插件（共 ${rows.length} 个）:`);
  lines.push('  ' + '-'.repeat(64));
  for (const r of rows) {
    lines.push(`  ${r.name.padEnd(28)} ${r.status.padEnd(10)} [${r.tag}]`);
  }
  lines.push('');
  return { handled: true, skipAgent: true, message: lines.join('\n') };
}

function togglePlugin(name: string, enable: boolean, config: NanoConfig | undefined): CommandInterceptResult {
  const whitelist = config ? getSystemWhitelist(config) : new Set<string>();

  if (whitelist.has(name)) {
    return { handled: true, skipAgent: true, message: `"${name}" 是系统插件，请通过 .nano-code.yaml 配置文件操作。` };
  }

  const PROJECT_CONFIG = path.join(process.cwd(), '.nano-code.yaml');
  let projectCfg: Record<string, any> = {};
  try {
    projectCfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf-8'));
  } catch { /* 文件不存在 */ }

  if (!projectCfg.plugins) projectCfg.plugins = {};
  if (!projectCfg.plugins[name]) projectCfg.plugins[name] = {};
  projectCfg.plugins[name].enabled = enable;

  try {
    fs.writeFileSync(PROJECT_CONFIG, JSON.stringify(projectCfg, null, 2), 'utf-8');
  } catch (err) {
    return { handled: true, skipAgent: true, message: `写入配置失败: ${err}` };
  }

  return { handled: true, skipAgent: true, message: `插件 "${name}" 已${enable ? '启用' : '禁用'}。` };
}

// ── /loop helper: parseLoopArgs ──

/** 解析 /loop 参数，返回 cron 表达式、prompt 和可读描述 */
function parseLoopArgs(input: string): { cron: string; prompt: string; humanReadable: string } | null {
  // 第一个 token 是间隔，剩余是 prompt
  const match = input.match(/^(\S+)\s+(.+)$/s);
  if (!match) return null;

  const interval = match[1];
  const prompt = match[2].trim();
  if (!prompt) return null;

  const cron = intervalToCron(interval);
  if (!cron) return null;

  return { cron, prompt, humanReadable: interval };
}

/** 将人类可读间隔（30s, 5m, 1h）转为 cron 表达式 */
function intervalToCron(interval: string): string | null {
  // 标准 5 字段 cron 表达式 → 直接返回
  if (/^(\S+\s+){4}\S+$/.test(interval)) return interval;
  // 6 字段（带秒）
  if (/^(\S+\s+){5}\S+$/.test(interval)) return interval;

  const m = interval.match(/^(\d+)(s|m|h)$/);
  if (!m) return null;

  const num = parseInt(m[1], 10);
  const unit = m[2];
  if (num <= 0) return null;

  switch (unit) {
    case 's':
      if (num < 5) return null; // 最少 5 秒
      return `*/${num} * * * * *`;  // 6 字段 cron（node-cron 支持）
    case 'm':
      return `*/${num} * * * *`;
    case 'h':
      return `0 */${num} * * *`;
    default:
      return null;
  }
}

const INIT_PROMPT = `请分析当前项目，创建一份 \`AGENT.md\` 文件。

## 任务说明

你正在创建一份给 AI 编程助手（nano-code）阅读的项目指南。这份文件将帮助 AI 理解项目的结构、约定和操作方式。

## 你需要做的是

1. **探索项目** — 使用 list_files、glob、read_file 等工具了解项目结构
2. **发现关键命令** — 查找构建、测试、lint 命令（package.json 的 scripts、Makefile、CI 配置等）
3. **理解架构** — 了解项目的主要模块、目录结构和依赖关系
4. **识别约定** — 找出代码风格、提交规范、分支策略等约定（从现有配置中推断）
5. **记录注意事项** — 记录非显而易见的陷阱、环境要求、特殊工作流

## AGENT.md 的内容要求

文件位于项目根目录，包含以下内容结构：

\`\`\`
# <Project Name>

This file provides guidance to nano-code when working with code in this repository.

## Build & Test

- 构建命令（如 \`npm run build\`）
- 测试命令（如 \`npm test\`）
- Lint/格式化命令
- 其他常用开发命令

## Architecture Overview

- 项目的主要语言和框架
- 目录结构说明（核心模块及其职责）
- 关键设计决策

## Code Style & Conventions

- 与语言默认规范不同的代码风格规则
- 命名约定
- 提交信息格式 / PR 规范
- 分支策略

## Notes

- 非显而易见的陷阱和注意事项
- 环境变量和设置步骤
- 特殊的工作流要求

## Key Files

- 项目关键文件的路径和用途说明（可选）
\`\`\`

## 指导原则

- **包含**：无法通过编程常识推断的信息、项目特有的命令和约定、非显而易见的架构决策
- **排除**：文件逐个列表、标准语言惯例（如"JavaScript 使用分号"）、通用编程建议、经常变化的信息（如 API 文档）、显而易见的命令（如 \`npm install\`）
- **引用**：使用 \`path/to/file\` 语法引用具体文件路径

## 现有配置

如果项目已存在 \`CLAUDE.md\`、\`.cursorrules\`、\`AGENTS.md\` 等 AI 配置文件，请读取它们，提取其中对 AI 仍有价值的信息合并到新的 \`AGENT.md\` 中。

## 输出

使用 Write 工具创建 \`AGENT.md\`。如果文件已存在，读取它并提供改进建议。`;
