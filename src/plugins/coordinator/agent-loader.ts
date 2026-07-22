import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { logManager } from '#src/utils/logger.js';

export interface AgentDefinition {
  name: string;
  description: string;
  role: string;
  greeting?: string;
  enabled?: boolean;
  plugins?: Record<string, any>;
  maxTurns?: number;
  systemPrompt?: {
    withTools?: string;
    noTools?: string;
    projectFiles?: string[];
  };
}

function getGlobalAgentDirs(customDirs?: string[]): string[] {
  if (customDirs && customDirs.length > 0) {
    return customDirs.map(d => path.resolve(d));
  }
  return [path.join(os.homedir(), '.nano-code', 'agents')];
}

/**
 * Load all agent definitions from YAML files in agent directories.
 * @param agentDirs — optional custom directories; defaults to `~/.nano-code/agents/`
 * Invalid files (missing required fields, parse errors) are skipped with a warning.
 * 同名 agent：按目录在列表中的顺序优先（先出现的生效）。
 */
export function loadAgentDefinitions(agentDirs?: string[]): AgentDefinition[] {
  const dirs = getGlobalAgentDirs(agentDirs);
  const seen = new Set<string>();
  const agents: AgentDefinition[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

      const filePath = path.join(dir, entry);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch {
        logManager.warn('agent-loader', ` 无法读取 "${entry}"，已跳过。`);
        continue;
      }

      let doc: any;
      try {
        doc = yaml.load(raw);
      } catch {
        logManager.warn('agent-loader', ` "${entry}" YAML 解析失败，已跳过。`);
        continue;
      }

      if (!doc || typeof doc !== 'object') {
        logManager.warn('agent-loader', ` "${entry}" 内容为空或非对象，已跳过。`);
        continue;
      }

      if (!doc.name || typeof doc.name !== 'string') {
        logManager.warn('agent-loader', ` "${entry}" 缺少必填字段 "name"，已跳过。`);
        continue;
      }

      if (seen.has(doc.name)) continue;

      if (!doc.description || typeof doc.description !== 'string') {
        logManager.warn('agent-loader', ` "${entry}" 缺少必填字段 "description"，已跳过。`);
        continue;
      }

      if (!doc.role || typeof doc.role !== 'string') {
        logManager.warn('agent-loader', ` "${entry}" 缺少必填字段 "role"，已跳过。`);
        continue;
      }

      seen.add(doc.name);
      agents.push(doc as AgentDefinition);
    }
  }

  return agents;
}
