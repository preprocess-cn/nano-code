/**
 * 诊断模块 — nano-code doctor
 *
 * 检查运行环境健康状态：配置、API 连通性、插件加载、系统环境。
 */

import { LLMClient } from './llm.js';
import { PluginRegistry } from './plugin.js';
import { NanoConfig } from './config.js';

export interface DoctorResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export async function runDoctor(
  config: NanoConfig,
  registry?: PluginRegistry,
  llmClient?: LLMClient,
): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];

  // 1. Node.js 版本
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  results.push({
    name: 'Node.js 版本',
    status: major >= 18 ? 'ok' : 'error',
    message: major >= 18 ? `${nodeVersion}` : `${nodeVersion}（需要 >= 18）`,
  });

  // 2. 配置版本
  results.push({
    name: '配置格式',
    status: 'ok',
    message: `版本 ${config.configVersion}`,
  });

  // 3. API Key
  const apiKey = config.core.apiKey || process.env.OPENAI_API_KEY;
  if (apiKey) {
    results.push({
      name: 'API Key',
      status: 'ok',
      message: `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
    });
  } else {
    results.push({
      name: 'API Key',
      status: 'error',
      message: '未配置 OPENAI_API_KEY',
    });
  }

  // 4. API 连通性
  if (llmClient) {
    try {
      const model = llmClient.getModel();
      // 尝试一个轻量请求验证连通性（发送短消息流式请求）
      let connected = false;
      try {
        await llmClient.sendSystemMessage(
          [{ role: 'user', content: 'ok' }],
          [],
          undefined, undefined, undefined,
          AbortSignal.timeout(10000),
        );
        connected = true;
      } catch (err: unknown) {
        // AbortError 也说明连上了（模型已响应的途中被终止）
        if (err instanceof Error && (err.name === 'AbortError' || err.message === 'CANCELLED')) {
          connected = true;
        }
      }
      results.push({
        name: `API 连通性（${model}）`,
        status: connected ? 'ok' : 'error',
        message: connected ? '连接成功' : '连接失败，请检查网络和 API Key',
      });
    } catch {
      results.push({
        name: 'API 连通性',
        status: 'error',
        message: '无法创建 LLM 客户端',
      });
    }
  }

  // 5. 插件状态
  if (registry) {
    const pluginList = registry.listPlugins();
    const totalTools = pluginList.reduce((sum, p) => sum + p.tools.length, 0);
    results.push({
      name: '插件',
      status: 'ok',
      message: `${pluginList.length} 个插件已注册，${totalTools} 个工具可用`,
    });

    // 检查是否有插件初始化失败
    const mcpPlugins = pluginList.filter(p => p.name.startsWith('mcp:'));
    for (const mp of mcpPlugins) {
      results.push({
        name: `MCP: ${mp.name}`,
        status: mp.tools.length > 0 ? 'ok' : 'warn',
        message: mp.tools.length > 0 ? `${mp.tools.length} 个工具` : '已注册但无工具（可能初始化失败）',
      });
    }
  } else {
    results.push({
      name: '插件',
      status: 'warn',
      message: 'CLI 模式下跳过插件检查，请在交互式会话中运行 /doctor 查看完整诊断',
    });
  }

  return results;
}

export function formatDoctorResults(results: DoctorResult[]): string {
  const lines: string[] = [''];
  lines.push('nano-code 诊断报告');
  lines.push('='.repeat(40));
  lines.push('');

  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    lines.push(`  ${icon} ${r.name}`);
    lines.push(`     ${r.message}`);
  }

  lines.push('');
  return lines.join('\n');
}
