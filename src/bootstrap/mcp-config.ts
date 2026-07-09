import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logManager } from '#src/utils/logger.js';

/**
 * .mcp.json 格式：MCP 服务器的标准配置文件。
 *
 * nano-code 全局位置：~/.nano-code/.mcp.json
 * 项目位置：$CWD/.mcp.json
 * Claude Code 全局位置（只读发现）：~/.claude/.mcp.json
 */
export interface McpJsonConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

const NANO_MCP_JSON = path.join(os.homedir(), '.nano-code', '.mcp.json');
const CLAUDE_MCP_JSON = path.join(os.homedir(), '.claude', '.mcp.json');

/** nano-code 全局 .mcp.json 路径（~/.nano-code/.mcp.json） */
export function getGlobalMcpJsonPath(): string {
  return NANO_MCP_JSON;
}

/** Claude Code 全局 .mcp.json 路径（~/.claude/.mcp.json，只读发现用） */
export function getClaudeMcpJsonPath(): string {
  return CLAUDE_MCP_JSON;
}

/** 项目 .mcp.json 路径（$CWD/.mcp.json） */
export function getProjectMcpJsonPath(cwd?: string): string {
  return path.join(cwd || process.cwd(), '.mcp.json');
}

/** 读取并解析一个 .mcp.json 文件，失败返回 null。 */
export function readMcpJson(filePath: string): McpJsonConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers !== null) {
      return parsed as McpJsonConfig;
    }
    logManager.warn('mcp', `${filePath} 缺少 "mcpServers" 字段，跳过。`);
    return null;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      logManager.warn('mcp', `读取 ${filePath} 失败: ${err.message}`);
    }
    return null;
  }
}

/** 原子写入 .mcp.json。目录不存在时自动创建。 */
export function writeMcpJson(filePath: string, config: McpJsonConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  const formatted = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(tmp, formatted, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/** 向 .mcp.json 添加或覆盖一个 MCP server 条目。 */
export function addMcpServer(
  filePath: string,
  name: string,
  serverConfig: McpServerConfig,
): void {
  const existing = readMcpJson(filePath) ?? { mcpServers: {} };
  existing.mcpServers[name] = serverConfig;
  writeMcpJson(filePath, existing);
}

/** 从 .mcp.json 移除一个 MCP server。返回 true 表示已删除。 */
export function removeMcpServer(filePath: string, name: string): boolean {
  const existing = readMcpJson(filePath);
  if (!existing || !(name in existing.mcpServers)) return false;
  delete existing.mcpServers[name];
  writeMcpJson(filePath, existing);
  return true;
}

/**
 * 扫描 Claude Code 的全局 .mcp.json，将尚未在 nano-code
 * 全局配置中的条目导入到 ~/.nano-code/.mcp.json。
 * 返回导入的条目数。
 */
export function importFromClaudeConfig(): number {
  const claudeCfg = readMcpJson(CLAUDE_MCP_JSON);
  if (!claudeCfg) return 0;

  const nanoCfg = readMcpJson(NANO_MCP_JSON) ?? { mcpServers: {} };
  let count = 0;

  for (const [name, config] of Object.entries(claudeCfg.mcpServers)) {
    if (!(name in nanoCfg.mcpServers)) {
      nanoCfg.mcpServers[name] = config;
      count++;
    }
  }

  if (count > 0) writeMcpJson(NANO_MCP_JSON, nanoCfg);
  return count;
}
