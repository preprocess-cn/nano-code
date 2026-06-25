import { CommandInterceptResult } from '../../contract.js';
import { NanoCodeAgent } from '../../agent.js';
import { PluginRegistry } from '../../plugin.js';
import { NanoConfig } from '../../config.js';
import { DisplayManager } from '../../display.js';
import { loadAllSkills } from '../skills/loader.js';
import { analyzeContextUsage, type ContextAnalysis } from '../token-budget/analyzer.js';
import type { BuiltinCommand } from './types.js';

export interface BuiltinContext {
  agent: NanoCodeAgent;
  registry: PluginRegistry;
  config: NanoConfig;
  display?: DisplayManager;
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
      lines.push('  /context          查看上下文分布及用量');
      lines.push('');

      const skills = loadAllSkills();
      if (skills.length > 0) {
        lines.push('可用技能（输入 /<技能名> 直接调用）：');
        for (const s of skills) {
          lines.push(`  /${s.name.padEnd(20)} ${s.description}`);
        }
        lines.push('');
      }

      lines.push('可直接执行的 bash 命令（输入 !<命令>）：');
      lines.push('  !ls -la            直接执行 ls -la');
      lines.push('  !npm test          直接运行测试');
      lines.push('');

      return { handled: true, skipAgent: true, message: lines.join('\n') };
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
      const getApiUsage = ctx.registry.store.get('token-budget:getApiUsage') as
        (() => { inputTokens: number; outputTokens: number; totalTokens: number }) | undefined;
      const apiTotalTokens = getApiUsage?.().totalTokens;

      const analysis = analyzeContextUsage(ctx.agent, ctx.registry, ctx.config, apiTotalTokens);

      // 推送结构化数据给展示层（Ink 渲染色块，REPL 无操作）
      ctx.display?.onContextAnalysis(analysis);

      const output = formatContextOutput(analysis);
      return { handled: true, skipAgent: true, message: output };
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
