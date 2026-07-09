import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import { loadConfig, getSystemWhitelist } from '#src/core/config.js';
import { loadAgentDefinitions } from '#src/core/agent-loader.js';
import {
  getProjectMcpJsonPath,
  getGlobalMcpJsonPath,
  getClaudeMcpJsonPath,
  addMcpServer,
  removeMcpServer,
  readMcpJson,
  importFromClaudeConfig,
} from '#src/core/mcp-config.js';

const GLOBAL_DIR = path.join(os.homedir(), '.nano-code');
const PROJECT_CONFIG = path.join(process.cwd(), '.nano-code.yaml');
const GLOBAL_CONFIG = path.join(GLOBAL_DIR, 'config.yaml');

export async function handlePluginCommand(args: string[], _globalOptions: any): Promise<void> {
  const cmd = args[0];
  switch (cmd) {
    case 'install': return installPlugin(args.slice(1));
    case 'uninstall': return uninstallPlugin(args.slice(1), _globalOptions);
    case 'list': return listPlugins();
    case 'enable': return setEnabled(args[1], true);
    case 'disable': return setEnabled(args[1], false);
    case 'mcp-add': return mcpAddCommand(args.slice(1), _globalOptions);
    case 'autoscan': return autoscanCommand();
    default:
      console.log('用法: nano-code plugin <command> [options]');
      console.log('');
      console.log('命令:');
      console.log('  install <source>      安装插件（npm 包 / git 仓库 / 本地路径）');
      console.log('  uninstall <name>      卸载插件（从所有配置中移除）');
      console.log('  mcp-add <name> [选项] 添加 MCP server（对标 claude mcp add）');
      console.log('  autoscan              扫描 ~/.claude/.mcp.json 导入插件到 nano-code');
      console.log('  list                  列出所有已安装插件');
      console.log('  enable <name>         启用插件');
      console.log('  disable <name>        禁用插件');
  }
}

// ── Install ──

async function installPlugin(sources: string[]): Promise<void> {
  const source = sources[0];
  if (!source) { console.error('请指定安装源。'); return; }

  if (isGitURL(source)) await installFromGit(source);
  else if (isLocalPath(source)) await installFromPath(source);
  else await installFromNpm(source);
}

function isGitURL(s: string): boolean {
  return /^https?:\/\/.+/.test(s) && s.includes('.git') || s.startsWith('git@');
}

function isLocalPath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || s.startsWith('~');
}

async function installFromNpm(spec: string): Promise<void> {
  let type: 'npm' | 'mcp' = 'mcp';
  let name = spec.split('/').pop() || spec;

  try {
    const mod = await import(spec);
    const plugin: any = (mod as any).default || mod;
    if (plugin && typeof plugin.name === 'string' && typeof plugin.execute === 'function') {
      type = 'npm';
      name = plugin.name;
    }
  } catch { /* 不是 NanoPlugin，降级为 MCP */ }

  const configEntry = type === 'npm'
    ? { type: 'npm', spec }
    : { type: 'mcp', command: 'npx', args: ['-y', spec] };

  addToProjectConfig(name, configEntry);
  console.log(`已安装插件 "${name}"（${type === 'npm' ? 'NanoPlugin' : 'MCP'}）`);
}

async function installFromGit(url: string): Promise<void> {
  const repoName = path.basename(url.replace(/\.git$/, ''));
  const targetDir = path.join(GLOBAL_DIR, 'sources', repoName);

  fs.mkdirSync(targetDir, { recursive: true });
  execSync(`git clone "${url}" "${targetDir}"`, { stdio: 'inherit' });
  if (fs.existsSync(path.join(targetDir, 'package.json'))) {
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
  }

  if (!await detectAndInstallFromDir(targetDir, repoName, url)) {
    console.error(`无法自动安装 "${url}"。`);
    console.error(`该项目可能不是 Node.js 插件。请尝试运行其官方安装脚本。`);
    console.error(`对于 MCP 类工具，nano-code 会自动从 ~/.claude/.mcp.json 发现已安装的 MCP server。`);
  }
}

async function installFromPath(localPath: string): Promise<void> {
  const resolved = path.resolve(localPath);
  const name = path.basename(resolved);

  if (!fs.existsSync(resolved)) {
    console.error(`路径不存在: ${resolved}`);
    return;
  }

  if (!await detectAndInstallFromDir(resolved, name, localPath)) {
    console.error(`无法识别 "${localPath}" 的插件类型。`);
  }
}

/** 从本地目录检测并安装插件（先检查 bin → MCP 写入 .mcp.json，再检查 main → NanoPlugin 写入 .nano-code.yaml）。 */
async function detectAndInstallFromDir(dir: string, name: string, source: string): Promise<boolean> {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  // MCP 模式：package.json 有 bin 字段 → 写入项目 .mcp.json
  if (pkg.bin) {
    const { addMcpServer, getProjectMcpJsonPath } = await import('#src/core/mcp-config.js');
    const binName = typeof pkg.bin === 'string' ? name : Object.keys(pkg.bin)[0];
    const binPath = typeof pkg.bin === 'string'
      ? path.join(dir, pkg.bin)
      : path.join(dir, pkg.bin[binName]);
    const filePath = getProjectMcpJsonPath();
    addMcpServer(filePath, binName, { command: 'node', args: [binPath] });
    addToProjectConfig(binName, { type: 'mcp' });  // 加 config.plugins 声明
    console.log(`已安装 MCP 插件 "${binName}" <- ${source}`);
    console.log(`配置已写入 ${filePath}，重启 nano-code 后生效。`);
    return true;
  }

  // NanoPlugin 模式：尝试 import 主入口
  const main = pkg.main || 'index.js';
  try {
    const mod = await import(path.join(dir, main));
    const plugin: any = (mod as any).default || mod;
    if (plugin && typeof plugin.name === 'string' && typeof plugin.execute === 'function') {
      addToProjectConfig(plugin.name, { type: 'npm', spec: dir });
      console.log(`已安装插件 "${plugin.name}" <- ${source}`);
      return true;
    }
  } catch {}

  return false;
}

function addToProjectConfig(name: string, entry: Record<string, any>): void {
  let cfg: Record<string, any> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf-8'));
  } catch { /* 文件不存在，使用空对象 */ }

  if (!cfg.plugins) cfg.plugins = {};
  cfg.plugins[name] = { ...entry, enabled: true };

  fs.writeFileSync(PROJECT_CONFIG, JSON.stringify(cfg, null, 2), 'utf-8');
  console.log(`已写入项目配置 ${PROJECT_CONFIG}`);
}

function addToGlobalConfig(name: string, entry: Record<string, any>): void {
  let cfg: Record<string, any> = {};
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG, 'utf-8');
    const parsed = yaml.load(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      cfg = parsed as Record<string, any>;
    }
  } catch { /* 文件不存在或解析失败 */ }

  if (!cfg.plugins) cfg.plugins = {};
  cfg.plugins[name] = { ...entry, enabled: true };

  fs.writeFileSync(GLOBAL_CONFIG, yaml.dump(cfg, { indent: 2 }), 'utf-8');
  console.log(`已写入全局配置 ${GLOBAL_CONFIG}`);
}

/** 检查某插件名是否已在项目或全局配置的 plugins 中声明。 */
function isDeclaredInConfig(name: string): boolean {
  for (const filePath of [PROJECT_CONFIG, GLOBAL_CONFIG]) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const cfg = parsed as Record<string, any>;
        if (cfg?.plugins?.[name]) return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

/** 卸载插件：按 scope 从对应域的 config + .mcp.json 中移除。
 *  scope 未指定时搜索所有域，能找到的都删除。 */
function uninstallPlugin(args: string[], globalOpts: Record<string, any> = {}): void {
  // 解析 --scope
  let scope: 'project' | 'user' | undefined;
  let name: string | undefined;
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--scope') {
      i++;
      if (i < args.length && (args[i] === 'project' || args[i] === 'user')) {
        scope = args[i] as 'project' | 'user';
      } else {
        console.error('--scope 需要参数 (project|user)');
        return;
      }
    } else if (!name) {
      name = args[i];
    } else {
      console.error(`未知参数: ${args[i]}`);
      return;
    }
    i++;
  }

  // cac 可能将 --scope 解析为 global option
  if (!scope && (globalOpts.scope === 'user' || globalOpts.scope === 'project')) {
    scope = globalOpts.scope;
  }

  if (!name) {
    console.error('请指定要卸载的插件名。');
    console.error('用法: nano-code plugin uninstall <name> [--scope project|user]');
    return;
  }

  const cleanProject = !scope || scope === 'project';
  const cleanUser = !scope || scope === 'user';
  let found = false;

  if (cleanProject) {
    try {
      const raw = fs.readFileSync(PROJECT_CONFIG, 'utf-8');
      const cfg = yaml.load(raw) as Record<string, any>;
      if (cfg?.plugins?.[name]) {
        delete cfg.plugins[name];
        if (Object.keys(cfg.plugins).length === 0) delete cfg.plugins;
        fs.writeFileSync(PROJECT_CONFIG, yaml.dump(cfg, { indent: 2 }), 'utf-8');
        console.log(`  已从项目配置 ${PROJECT_CONFIG} 中移除`);
        found = true;
      }
    } catch { /* 文件不存在或无需清理 */ }
  }

  if (cleanUser) {
    try {
      const raw = fs.readFileSync(GLOBAL_CONFIG, 'utf-8');
      const cfg = yaml.load(raw) as Record<string, any>;
      if (cfg?.plugins?.[name]) {
        delete cfg.plugins[name];
        if (Object.keys(cfg.plugins).length === 0) delete cfg.plugins;
        fs.writeFileSync(GLOBAL_CONFIG, yaml.dump(cfg, { indent: 2 }), 'utf-8');
        console.log(`  已从全局配置 ${GLOBAL_CONFIG} 中移除`);
        found = true;
      }
    } catch { /* 文件不存在或无需清理 */ }
  }

  if (cleanProject) {
    if (removeMcpServer(getProjectMcpJsonPath(), name)) {
      console.log(`  已从项目 ${getProjectMcpJsonPath()} 中移除`);
      found = true;
    }
  }

  if (cleanUser) {
    if (removeMcpServer(getGlobalMcpJsonPath(), name)) {
      console.log(`  已从全局 ${getGlobalMcpJsonPath()} 中移除`);
      found = true;
    }
  }

  if (!found) {
    console.log(`插件 "${name}" 未在任何配置文件中找到。`);
  } else {
    console.log(`插件 "${name}" 已卸载。`);
  }
}

// ── mcp-add ──

async function mcpAddCommand(args: string[], globalOpts: Record<string, any> = {}): Promise<void> {
  // Parse: nano-code plugin mcp-add <name> [--scope user] [-e KEY=VAL] [--transport http] [--url URL] [-- <command> <args...>]
  const parsed = parseMcpAddArgs(args);
  if (!parsed) return;

  // cac 可能将 --scope 解析为 global option，补充进来
  if (!parsed.scopeOverridden && (globalOpts.scope === 'user' || globalOpts.scope === 'project')) {
    parsed.scope = globalOpts.scope;
  }

  const { name, scope, env, transport, url, command, cmdArgs } = parsed;

  // Determine target file（user → nano-code 全局，project → 项目目录）
  const filePath = scope === 'user'
    ? path.join(os.homedir(), '.nano-code', '.mcp.json')
    : getProjectMcpJsonPath();

  let serverConfig: Record<string, any>;
  if (transport === 'http' || transport === 'sse') {
    if (!url) {
      console.error(`--transport ${transport} 需要指定 --url。`);
      return;
    }
    serverConfig = { url };
  } else {
    if (!command) {
      console.error('stdio 模式需要指定命令：nano-code plugin mcp-add <name> -- <command> [args...]');
      return;
    }
    serverConfig = { command, args: cmdArgs };
    if (Object.keys(env).length > 0) serverConfig.env = env;
  }

  addMcpServer(filePath, name, serverConfig);

  // 同时在对应域的 config.plugins 中加 type: mcp 声明，使 server 能被加载
  if (scope === 'user') {
    addToGlobalConfig(name, { type: 'mcp' });
  } else {
    addToProjectConfig(name, { type: 'mcp' });
  }

  console.log(`MCP server "${name}" 已添加到 ${filePath}`);
  console.log(`重启 nano-code 后生效，或运行 /reload-plugins 立即加载。`);
}

// ── autoscan ──

async function autoscanCommand(): Promise<void> {
  const claudePath = getClaudeMcpJsonPath();
  const claudeCfg = readMcpJson(claudePath);
  if (!claudeCfg || Object.keys(claudeCfg.mcpServers).length === 0) {
    console.log(`~/.claude/.mcp.json 中未发现 MCP server。`);
    return;
  }

  const count = importFromClaudeConfig();

  // 为新导入的 server 添加全局 config.plugins 声明（type: mcp），使其能被加载
  let stubCount = 0;
  for (const name of Object.keys(claudeCfg.mcpServers)) {
    if (!isDeclaredInConfig(name)) {
      addToGlobalConfig(name, { type: 'mcp' });
      stubCount++;
    }
  }

  if (count === 0 && stubCount === 0) {
    console.log(`已扫描 ~/.claude/.mcp.json，全部条目已在对应配置中，无需操作。`);
    return;
  }

  console.log(`已从 Claude Code 导入 ${count} 个 MCP server；添加 ${stubCount} 个声明：`);
  for (const [name, cfg] of Object.entries(claudeCfg.mcpServers)) {
    console.log(`  ${name.padEnd(30)} ${cfg.command || cfg.url || ''}`);
  }
  console.log(`重启 nano-code 后生效，或运行 /reload-plugins 立即加载。`);
}

interface McpAddParsed {
  name: string;
  scope: 'project' | 'user';
  scopeOverridden: boolean;
  env: Record<string, string>;
  transport: string;
  url?: string;
  command?: string;
  cmdArgs: string[];
}

function parseMcpAddArgs(args: string[]): McpAddParsed | null {
  if (args.length === 0) {
    console.error('用法: nano-code plugin mcp-add <name> [选项] [-- <command> <args...>]');
    console.error('示例:');
    console.error('  nano-code plugin mcp-add my-server -- npx -y my-mcp-package');
    console.error('  nano-code plugin mcp-add my-server --scope user -- npx -y my-mcp-package');
    console.error('  nano-code plugin mcp-add my-server --transport http --url http://localhost:8080');
    return null;
  }

  const name = args[0];
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error('插件名只能包含字母、数字、连字符和下划线。');
    return null;
  }

  let scope: 'project' | 'user' = 'project';
  let scopeOverridden = false;
  const env: Record<string, string> = {};
  let transport = 'stdio';
  let url: string | undefined;
  let command: string | undefined;
  const cmdArgs: string[] = [];

  let i = 1;
  let afterDoubleDash = false;

  while (i < args.length) {
    const arg = args[i];

    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true;
      i++;
      continue;
    }

    if (!afterDoubleDash && arg.startsWith('--')) {
      switch (arg) {
        case '--scope':
          i++;
          if (i >= args.length) { console.error('--scope 需要参数 (project|user)'); return null; }
          if (args[i] !== 'project' && args[i] !== 'user') { console.error('--scope 只能是 project 或 user'); return null; }
          scope = args[i] as 'project' | 'user';
          scopeOverridden = true;
          break;
        case '--transport':
          i++;
          if (i >= args.length) { console.error('--transport 需要参数 (stdio|http|sse)'); return null; }
          if (!['stdio', 'http', 'sse'].includes(args[i])) { console.error('--transport 只能是 stdio、http 或 sse'); return null; }
          transport = args[i];
          break;
        case '--url':
          i++;
          if (i >= args.length) { console.error('--url 需要参数'); return null; }
          url = args[i];
          break;
        default:
          console.error(`未知选项: ${arg}`);
          return null;
      }
      i++;
      continue;
    }

    if (!afterDoubleDash && (arg === '-e' || arg === '--env')) {
      i++;
      if (i >= args.length) { console.error('-e 需要 KEY=VAL 格式'); return null; }
      const match = args[i].match(/^([^=]+)=(.*)$/);
      if (!match) { console.error(`环境变量格式错误: ${args[i]} （应为 KEY=VAL）`); return null; }
      env[match[1]] = match[2];
      i++;
      continue;
    }

    if (!afterDoubleDash && arg.startsWith('-') && arg !== '-e') {
      console.error(`未知选项: ${arg}`);
      return null;
    }

    // Positional args
    if (command === undefined) {
      command = arg;
    } else {
      cmdArgs.push(arg);
    }
    i++;
  }

  return { name, scope, scopeOverridden, env, transport, url, command, cmdArgs };
}

// ── List ──

async function listPlugins(): Promise<void> {
  const config = loadConfig();
  const whitelist = getSystemWhitelist(config);

  // 收集所有插件名：已配置的 + 系统白名单中未配置的 + agent 定义 + .mcp.json 中的 MCP server
  const names = new Set(Object.keys(config.plugins));
  for (const w of whitelist) names.add(w);

  // 扫描 .mcp.json 中的 MCP server
  const mcpJsonNames = new Set<string>();
  const claudeJsonNames = new Set<string>();
  for (const f of [getProjectMcpJsonPath(), getGlobalMcpJsonPath()]) {
    const cfg = readMcpJson(f);
    if (cfg) for (const name of Object.keys(cfg.mcpServers)) { names.add(name); mcpJsonNames.add(name); }
  }
  // Claude Code 全局配置（仅供显示，不做自动发现）
  const claudeCfg = readMcpJson(getClaudeMcpJsonPath());
  if (claudeCfg) {
    for (const name of Object.keys(claudeCfg.mcpServers)) {
      if (!mcpJsonNames.has(name)) { names.add(name); claudeJsonNames.add(name); }
    }
  }

  // 判定哪些 .mcp.json server 缺少 config.plugins 声明（实际不会被加载）
  const undelcaredMcpNames = new Set<string>();
  for (const name of mcpJsonNames) {
    if (!(name in config.plugins)) undelcaredMcpNames.add(name);
  }

  const rows: Array<{ name: string; status: string; tag: string }> = [];
  for (const name of names) {
    const inCfg = name in config.plugins;
    const enabled = inCfg ? config.plugins[name].enabled !== false : false;
    const status = undelcaredMcpNames.has(name) ? '未声明'
      : (enabled ? 'active' : 'inactive');
    const tag = whitelist.has(name) ? 'system'
      : (config.plugins[name]?.type || (mcpJsonNames.has(name) ? 'mcp'
        : (claudeJsonNames.has(name) ? 'claude' : 'user')));
    rows.push({ name, status, tag });
  }

  // 添加 agent 插件
  for (const def of loadAgentDefinitions()) {
    rows.push({
      name: `agent:${def.name}`,
      status: def.enabled !== false ? 'active' : 'inactive',
      tag: 'agent',
    });
  }

  rows.sort((a, b) => {
    const prio: Record<string, number> = { system: 0, agent: 1, user: 2, builtin: 2, npm: 2, mcp: 2 };
    const pa = prio[a.tag] ?? 3;
    const pb = prio[b.tag] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  console.log(`\n  已安装插件（共 ${rows.length} 个）:`);
  console.log('  ' + '-'.repeat(64));
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(28)} ${r.status.padEnd(10)} [${r.tag}]`);
  }
  console.log('');
}

// ── Enable / Disable ──

async function setEnabled(name: string, enabled: boolean): Promise<void> {
  if (!name) { console.error('请指定插件名。'); return; }

  // Handle agent plugins (agent:<name>)
  if (name.startsWith('agent:')) {
    const agentName = name.slice(6);
    const agentPath = path.join(os.homedir(), '.nano-code', 'agents', `${agentName}.yaml`);
    if (!fs.existsSync(agentPath)) {
      // 也尝试 .yml 后缀
      const altPath = path.join(os.homedir(), '.nano-code', 'agents', `${agentName}.yml`);
      if (!fs.existsSync(altPath)) {
        console.error(`Agent "${agentName}" 未找到。`);
        return;
      }
      updateAgentEnabled(altPath, enabled, agentName);
    } else {
      updateAgentEnabled(agentPath, enabled, agentName);
    }
    return;
  }

  const config = loadConfig();
  const whitelist = getSystemWhitelist(config);

  if (whitelist.has(name)) {
    console.error(`"${name}" 是系统插件，请通过 .nano-code.yaml 配置文件操作。`);
    return;
  }

  let projectCfg: Record<string, any> = {};
  try {
    projectCfg = JSON.parse(fs.readFileSync(PROJECT_CONFIG, 'utf-8'));
  } catch { /* 文件不存在，使用空对象 */ }

  if (!projectCfg.plugins) projectCfg.plugins = {};
  if (!projectCfg.plugins[name]) projectCfg.plugins[name] = {};
  projectCfg.plugins[name].enabled = enabled;

  fs.writeFileSync(PROJECT_CONFIG, JSON.stringify(projectCfg, null, 2), 'utf-8');
  console.log(`插件 "${name}" 已${enabled ? '启用' : '禁用'}。`);
}

/**
 * 打印运行中注册表的所有插件及其工具（--list-plugins 模式使用）。
 * 与上方 listPlugins() 不同，此函数操作运行时的 PluginRegistry 实例。
 */
export function printPluginList(registry: import('#src/core/plugin.js').PluginRegistry): void {
  const plugins = registry.listPlugins();
  if (plugins.length === 0) {
    console.log('\n  当前没有注册任何插件。\n');
    return;
  }

  console.log(`\n  已注册插件 (${plugins.length}):\n`);
  for (const p of plugins) {
    const tag = p.name.startsWith('mcp:') ? 'MCP' : p.name.startsWith('agent:') ? 'agent' : '内置';
    console.log(`  ${p.name} [${tag}]`);
    if (p.description) {
      console.log(`   〉${p.description}`);
    }
    const tools = p.tools;
    if (tools.length > 0) {
      for (const t of tools) {
        const desc = t.function.description.replace(/\n.*/s, '').slice(0, 80);
        console.log(`    • ${t.function.name.padEnd(22)} ${desc}`);
      }
    } else {
      console.log(`    (无工具 — 仅挂载钩子)`);
    }
    console.log('');
  }
}

function updateAgentEnabled(filePath: string, enabled: boolean, agentName: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(raw) as Record<string, any>;
    if (!data || typeof data !== 'object') {
      console.error(`无法解析 agent 定义文件 "${agentName}"。`);
      return;
    }
    data.enabled = enabled;
    fs.writeFileSync(filePath, yaml.dump(data, { indent: 2 }), 'utf-8');
    console.log(`Agent "${agentName}" 已${enabled ? '启用' : '禁用'}。`);
  } catch (err) {
    console.error(`操作 agent "${agentName}" 失败:`, err);
  }
}
