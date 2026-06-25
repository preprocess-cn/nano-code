import { NanoCodeAgent } from '../../agent.js';
import { PluginRegistry } from '../../plugin.js';
import { NanoConfig } from '../../config.js';
import { buildSystemPrompt } from '../../prompt.js';
import { loadAgentDefinitions } from '../../agent-loader.js';
import { loadAllSkills } from '../skills/loader.js';
import * as fs from 'fs';
import * as path from 'path';
import { countTokens, countMessagesTokens } from './counter.js';

// ── Types ──

export interface ContextItem {
  name: string;
  tokens: number;
}

export interface ContextDimension {
  name: string;
  tokens: number;
  percentage: number;
  items: ContextItem[];
}

export interface ContextAnalysis {
  modelName: string;
  contextWindow: number;
  totalTokens: number;
  usageSource: 'api' | 'estimated';
  percentage: number;
  dimensions: ContextDimension[];
  freeTokens: number;
}

// ── Context window lookup ──

const MODEL_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16384,
  'deepseek-chat': 65536,
  'deepseek-coder': 128000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
};

function resolveContextWindow(modelName: string, config: NanoConfig): number {
  for (const [prefix, window] of Object.entries(MODEL_WINDOWS)) {
    if (modelName.startsWith(prefix)) return window;
  }
  return config.core.maxTokens || 128000;
}

// ── System Prompt analysis ──

function analyzeSystemPrompt(registry: PluginRegistry, config: NanoConfig): { dimension: ContextDimension; foundFiles: string[] } {
  const items: ContextItem[] = [];
  const foundFiles: string[] = [];

  // Build system prompt to count
  const systemMessage = buildSystemPrompt(registry, config.systemPrompt);
  const chain = registry.execSystemPrompt(systemMessage.content || '');
  const fullPrompt = typeof chain === 'string' ? chain : systemMessage.content || '';
  const totalTokens = countTokens(fullPrompt);

  // Break down into parts
  const parts = config.systemPrompt?.projectFiles ?? ['AGENT.md'];
  items.push({ name: 'role template', tokens: countTokens(config.systemPrompt?.withTools || config.systemPrompt?.noTools || '') });
  for (const file of parts) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      if (content.trim()) {
        items.push({ name: file, tokens: countTokens(content.trim()) });
        foundFiles.push(file);
        break;
      }
    } catch { /* skip missing */ }
  }
  const hookTokens = totalTokens - items.reduce((s, i) => s + i.tokens, 0);
  if (hookTokens > 0) items.push({ name: 'plugin hooks', tokens: hookTokens });

  return {
    dimension: {
      name: 'System Prompt',
      tokens: totalTokens,
      percentage: 0,
      items,
    },
    foundFiles,
  };
}

// ── Tools analysis ──

function analyzeTools(registry: PluginRegistry): ContextDimension {
  const schemas = registry.getAllSchemas();
  const items: ContextItem[] = [];
  for (const s of schemas) {
    items.push({
      name: `${s.function.name}`,
      tokens: countTokens(JSON.stringify(s)),
    });
  }
  const total = items.reduce((s, i) => s + i.tokens, 0);
  return { name: 'Tools', tokens: total, percentage: 0, items };
}

// ── MCP Tools analysis ──

function analyzeMcpTools(registry: PluginRegistry): ContextDimension {
  // Identify MCP plugins: those with "mcp" in their name/description
  const allPlugins = registry.listPlugins();
  const mcpPlugins = allPlugins.filter(p =>
    p.name.includes('mcp') || p.name.startsWith('MCP') || p.description?.toLowerCase().includes('mcp server'),
  );
  // Collect schemas that belong to MCP plugins
  const allSchemas = registry.getAllSchemas();
  const mcpToolNames = new Set<string>();
  for (const plugin of mcpPlugins) {
    for (const tool of plugin.tools) {
      mcpToolNames.add(tool.function.name);
    }
  }
  const mcpSchemas = allSchemas.filter(s => mcpToolNames.has(s.function.name));
  const items: ContextItem[] = [];
  for (const s of mcpSchemas) {
    items.push({
      name: s.function.name,
      tokens: countTokens(JSON.stringify(s)),
    });
  }
  const total = items.reduce((s, i) => s + i.tokens, 0);
  return { name: 'MCP Tools', tokens: total, percentage: 0, items };
}

// ── Custom Agents analysis ──

function analyzeCustomAgents(): ContextDimension {
  const agents = loadAgentDefinitions();
  const items: ContextItem[] = [];
  for (const a of agents) {
    const text = `${a.name} ${a.description} ${a.role}`;
    items.push({ name: a.name, tokens: countTokens(text) });
  }
  const total = items.reduce((s, i) => s + i.tokens, 0);
  return { name: 'Custom Agents', tokens: total, percentage: 0, items };
}

// ── Memory Files analysis ──

function analyzeMemoryFiles(config: NanoConfig, excludeFiles: string[] = []): ContextDimension {
  const excludeSet = new Set(excludeFiles);
  const files = config.systemPrompt?.projectFiles ?? ['AGENT.md', 'CLAUDE.md'];
  const items: ContextItem[] = [];
  for (const name of files) {
    if (excludeSet.has(name)) continue; // 已在 System Prompt 中统计
    try {
      const content = fs.readFileSync(path.join(process.cwd(), name), 'utf-8');
      if (content.trim()) {
        items.push({ name, tokens: countTokens(content.trim()) });
      }
    } catch { /* skip missing */ }
  }
  const total = items.reduce((s, i) => s + i.tokens, 0);
  return { name: 'Memory Files', tokens: total, percentage: 0, items };
}

// ── Skills analysis ──

function analyzeSkills(): ContextDimension {
  const skills = loadAllSkills();
  const items: ContextItem[] = [];
  for (const s of skills) {
    const text = `${s.name} ${s.description}`;
    items.push({ name: s.name, tokens: countTokens(text) });
  }
  const total = items.reduce((s, i) => s + i.tokens, 0);
  return { name: 'Skills', tokens: total, percentage: 0, items };
}

// ── Messages analysis ──

function analyzeMessages(agent: NanoCodeAgent): ContextDimension {
  const history = agent.getHistory();
  const roleOrder = ['system', 'user', 'assistant', 'tool'] as const;
  const roleLabels: Record<string, string> = {
    system: 'system',
    user: 'user',
    assistant: 'assistant',
    tool: 'tool',
  };

  // Group by role
  const byRole: Record<string, { count: number; tokens: number }> = {};
  for (const m of history) {
    if (!byRole[m.role]) byRole[m.role] = { count: 0, tokens: 0 };
    byRole[m.role].count++;
    byRole[m.role].tokens += countTokens(m.content || '') + 4;
  }

  const items: ContextItem[] = [];
  let total = 0;
  for (const role of roleOrder) {
    if (byRole[role]) {
      items.push({
        name: `${roleLabels[role]} (${byRole[role].count})`,
        tokens: byRole[role].tokens,
      });
      total += byRole[role].tokens;
    }
  }

  return { name: 'Messages', tokens: total, percentage: 0, items };
}

// ── Public API ──

/**
 * Analyze context usage across all 7 dimensions.
 *
 * Token priority:
 * 1. API usage data from token-budget (accumulated across requests)
 * 2. tiktoken estimation (fallback)
 */
export function analyzeContextUsage(
  agent: NanoCodeAgent,
  registry: PluginRegistry,
  config: NanoConfig,
  apiTotalTokens?: number,
): ContextAnalysis {
  const systemResult = analyzeSystemPrompt(registry, config);
  const dimensions: ContextDimension[] = [
    systemResult.dimension,
    analyzeTools(registry),
    analyzeMcpTools(registry),
    analyzeCustomAgents(),
    analyzeMemoryFiles(config, systemResult.foundFiles),
    analyzeSkills(),
    analyzeMessages(agent),
  ];

  // Calculate totals
  const estimatedTokens = dimensions.reduce((s, d) => s + d.tokens, 0);

  // Priority 1: use API usage data if available (more accurate)
  const hasApiData = apiTotalTokens != null && apiTotalTokens > 0;
  const totalTokens = hasApiData ? apiTotalTokens! : estimatedTokens;

  const modelName = config.core.model || process.env.OPENAI_MODEL_NAME || 'gpt-4o';
  const contextWindow = resolveContextWindow(modelName, config);
  const percentage = Math.round((totalTokens / contextWindow) * 1000) / 10;

  // Calculate per-dimension percentages based on totalTokens
  for (const d of dimensions) {
    d.percentage = totalTokens > 0
      ? Math.round((d.tokens / contextWindow) * 1000) / 10
      : 0;
  }

  return {
    modelName,
    contextWindow,
    totalTokens,
    usageSource: hasApiData ? 'api' : 'estimated',
    percentage,
    dimensions,
    freeTokens: Math.max(0, contextWindow - totalTokens),
  };
}
