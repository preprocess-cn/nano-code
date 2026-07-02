import type OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import type { ToolDefinition } from './contract.js';
import { withRetry } from './retry.js';

// ── Lazy OpenAI import ──
// 使用动态 import() 替代静态导入，以便在 openai 包或其子依赖缺失时
// 给出友好的中文错误提示，而不是 Node.js 的 ERR_MODULE_NOT_FOUND。
let openaiModule: typeof import('openai') | null = null;
let openaiLoadError: Error | null = null;

async function ensureOpenAI(): Promise<typeof import('openai')> {
  if (openaiModule) return openaiModule;
  if (openaiLoadError) throw openaiLoadError;
  try {
    openaiModule = await import('openai');
    return openaiModule;
  } catch (err: any) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.message?.includes('Cannot find module')) {
      openaiLoadError = new Error(
        '依赖 "openai" 包未找到。请运行 "npm install" 安装所有依赖。'
      );
    } else {
      openaiLoadError = err;
    }
    throw openaiLoadError;
  }
}

// 加载环境变量：项目 .env 优先于全局 ~/.nano-code/.env，shell 环境变量优先于两者
dotenv.config();                                                                  // $CWD/.env
dotenv.config({ path: path.join(os.homedir(), '.nano-code', '.env') });          // ~/.nano-code/.env 兜底

export interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseURL?: string;
}

/**
 * 格式化后的标准消息历史接口（兼容 OpenAI 的标准格式）
 */
/** OpenAI 流式返回的 tool_calls delta 片段（含 index 用于拼合） */
export interface ToolCallDelta {
  index: number;
  id?: string;
  function: { name?: string; arguments?: string };
}

/** 拼合后的完整 tool call（用于消息历史） */
export interface AssembledToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: AssembledToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ── Retry configuration ──

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Determine whether an error is transient and worth retrying.
 * Covers rate limits, server errors, and common network glitches.
 */
function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (err.status === 429) return true;                          // rate limit
  if (typeof err.status === 'number' && err.status >= 500) return true; // server error
  if (typeof err.code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(err.code)) return true;
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('network')) return true;
  }
  return false;
}

export class LLMClient {
  private _openai: OpenAI | null = null;
  private model = 'gpt-4o';
  private temperature = 0;
  private config: LLMConfig;

  getModel(): string {
    return this.model;
  }

  constructor(config?: LLMConfig) {
    // 立即验证 API Key，但延迟加载 openai 包
    this.config = config || {};
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('未能在环境变量中找到 OPENAI_API_KEY。请在 .env 文件中配置。');
    }
  }

  private async ensureClient(): Promise<void> {
    if (this._openai) return;
    const { default: OpenAI } = await ensureOpenAI();
    const apiKey = this.config?.apiKey || process.env.OPENAI_API_KEY;
    this.model = this.config?.model || process.env.OPENAI_MODEL_NAME || 'gpt-4o';
    this.temperature = this.config?.temperature ?? 0;
    this._openai = new OpenAI({
      apiKey,
      baseURL: this.config?.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }

  /**
   * 发送消息并获取流式响应（支持工具调用）
   *
   * NOTE: The `messages` array is now expected to ALREADY include the system message
   * (prepended by the caller via prompt.ts). This method passes it through directly.
   *
   * @param messages 对话记录（含 system 消息）
   * @param tools 传递给模型的本地可调用函数声明列表 (符合 OpenAI ChatCompletionTool 格式)
   * @param onChunk 流式文本返回时的回调函数
   */
  async sendSystemMessage(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onChunk?: (text: string) => void,
    extraParams?: Record<string, unknown>,
    onMeta?: (meta: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ) {
    await this.ensureClient();
    const openai = this._openai!;
    try {
      return await withRetry(async () => {
        if (signal?.aborted) throw new Error('CANCELLED');

        const stream = await openai.chat.completions.create({
          model: this.model,
          ...extraParams,
          messages: messages as any,
          stream: true,
          stream_options: { include_usage: true },
          tools: tools && tools.length > 0 ? (tools as any) : undefined,
          temperature: this.temperature,
        }, { signal });

        let fullText = '';
        const finalToolCalls: AssembledToolCall[] = [];
        let finalMeta: Record<string, unknown> | undefined;

        for await (const chunk of stream) {
          if (chunk.usage) {
            finalMeta = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            if (onChunk) onChunk(delta.content);
          }

          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;
              if (!finalToolCalls[index]) {
                finalToolCalls[index] = {
                  id: toolCallDelta.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (toolCallDelta.function?.name) {
                finalToolCalls[index].function.name += toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                finalToolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }

        const validToolCalls = finalToolCalls.filter(tc => tc && tc.function.name);
        if (finalMeta && onMeta) onMeta(finalMeta);

        return {
          text: fullText,
          toolCalls: validToolCalls.length > 0 ? validToolCalls : undefined,
          stopReason: validToolCalls.length > 0 ? 'tool_use' : 'stop',
        };
      }, {
        maxRetries: MAX_RETRIES,
        delaysMs: RETRY_DELAYS_MS,
        label: 'llm',
        isTransient: isTransientError,
      });
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message === 'CANCELLED') {
        throw error;
      }
      console.error('[llm] API request failed:', error);
      throw error;
    }
  }
}
