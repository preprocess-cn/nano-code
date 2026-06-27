import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import { loadConfig, getSystemWhitelist } from './config.js';
import { loadAgentDefinitions } from './agent-loader.js';

const GLOBAL_DIR = path.join(os.homedir(), '.nano-code');
const PROJECT_CONFIG = path.join(process.cwd(), '.nano-code.yaml');

export async function handlePluginCommand(args: string[], _globalOptions: any): Promise<void> {
  const cmd = args[0];
  switch (cmd) {
    case 'install': return installPlugin(args.slice(1));
    case 'list': return listPlugins();
    case 'enable': return setEnabled(args[1], true);
    case 'disable': return setEnabled(args[1], false);
    default:
      console.log('用法: nano-code plugin <command> [options]');
      console.log('');
      console.log('命令:');
      console.log('  install <source>   安装插件（npm 包 / git 仓库 / 本地路径）');
      console.log('  list               列出所有已安装插件');
      console.log('  enable <name>      启用插件');
      console.log('  disable <name>     禁用插件');
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
    console.error(`无法识别 "${url}" 的插件类型。`);
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

/** 从本地目录检测并安装插件（先检查 bin → MCP，再检查 main → NanoPlugin）。 */
async function detectAndInstallFromDir(dir: string, name: string, source: string): Promise<boolean> {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  // MCP 模式：package.json 有 bin 字段
  if (pkg.bin) {
    const binName = typeof pkg.bin === 'string' ? name : Object.keys(pkg.bin)[0];
    const binPath = typeof pkg.bin === 'string'
      ? path.join(dir, pkg.bin)
      : path.join(dir, pkg.bin[binName]);
    addToProjectConfig(binName, { type: 'mcp', command: 'node', args: [binPath] });
    console.log(`已安装 MCP 插件 "${binName}" <- ${source}`);
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

// ── List ──

async function listPlugins(): Promise<void> {
  const config = loadConfig();
  const whitelist = getSystemWhitelist(config);

  // 收集所有插件名：已配置的 + 系统白名单中未配置的 + agent 定义
  const names = new Set(Object.keys(config.plugins));
  for (const w of whitelist) names.add(w);

  const rows: Array<{ name: string; status: string; tag: string }> = [];
  for (const name of names) {
    const cfg = config.plugins[name];
    const enabled = cfg ? cfg.enabled !== false : true;
    const tag = whitelist.has(name) ? 'system' : (cfg?.type || 'user');
    rows.push({ name, status: enabled ? 'active' : 'inactive', tag });
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
export function printPluginList(registry: import('./plugin.js').PluginRegistry): void {
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
