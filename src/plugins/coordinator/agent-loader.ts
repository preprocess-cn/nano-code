import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

export interface AgentDefinition {
  name: string;
  description: string;
  role: string;
  greeting?: string;
  enabled?: boolean;
  plugins?: Record<string, any>;
  systemPrompt?: {
    withTools?: string;
    noTools?: string;
    projectFiles?: string[];
  };
}

function getGlobalAgentDir(): string {
  return path.join(os.homedir(), '.nano-code', 'agents');
}

/**
 * Load all agent definitions from `~/.nano-code/agents/*.yaml`.
 * @param agentDir — optional test injection; defaults to `~/.nano-code/agents/`
 * Invalid files (missing required fields, parse errors) are skipped with a warning.
 */
export function loadAgentDefinitions(agentDir?: string): AgentDefinition[] {
  const dir = agentDir || getGlobalAgentDir();
  if (!fs.existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

    const filePath = path.join(dir, entry);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      console.warn(`[agent-loader] 无法读取 "${entry}"，已跳过。`);
      continue;
    }

    let doc: any;
    try {
      doc = yaml.load(raw);
    } catch {
      console.warn(`[agent-loader] "${entry}" YAML 解析失败，已跳过。`);
      continue;
    }

    if (!doc || typeof doc !== 'object') {
      console.warn(`[agent-loader] "${entry}" 内容为空或非对象，已跳过。`);
      continue;
    }

    if (!doc.name || typeof doc.name !== 'string') {
      console.warn(`[agent-loader] "${entry}" 缺少必填字段 "name"，已跳过。`);
      continue;
    }

    if (!doc.description || typeof doc.description !== 'string') {
      console.warn(`[agent-loader] "${entry}" 缺少必填字段 "description"，已跳过。`);
      continue;
    }

    if (!doc.role || typeof doc.role !== 'string') {
      console.warn(`[agent-loader] "${entry}" 缺少必填字段 "role"，已跳过。`);
      continue;
    }

    agents.push(doc as AgentDefinition);
  }

  return agents;
}
