import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import { MSG_API_RETRY, MSG_API_ERROR } from './display-strings.js';

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
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: any[];
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
function isTransientError(error: any): boolean {
  if (error?.status === 429) return true;                          // rate limit
  if (error?.status && error.status >= 500) return true;           // server error
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(error?.code)) return true;
  if (error?.message) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('network')) return true;
  }
  return false;
}

export class LLMClient {
  private openai: OpenAI;
  private model: string;
  private temperature: number;

  getModel(): string {
    return this.model;
  }

  constructor(config?: LLMConfig) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('未能在环境变量中找到 OPENAI_API_KEY。请在 .env 文件中配置。');
    }

    this.openai = new OpenAI({
      apiKey,
      baseURL: config?.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    this.model = config?.model || process.env.OPENAI_MODEL_NAME || 'gpt-4o';
    this.temperature = config?.temperature ?? 0;
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
    tools: any[],
    onChunk?: (text: string) => void,
    extraParams?: Record<string, unknown>,
    onMeta?: (meta: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ) {
    // ── Retry loop with exponential backoff ──
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) throw new Error('CANCELLED');

        // 请求 OpenAI 的流式接口
                const stream = await this.openai.chat.completions.create({
          model: this.model,
          ...extraParams,
          messages: messages as any,
          stream: true,
          stream_options: { include_usage: true },
          tools: tools && tools.length > 0 ? tools : undefined,
          temperature: this.temperature,
        }, { signal });

        let fullText = '';
        let finalToolCalls: any[] = [];
        let finalMeta: Record<string, unknown> | undefined;

        for await (const chunk of stream) {
          // Capture usage from the final chunk (present when stream_options.include_usage is true)
          if (chunk.usage) {
            finalMeta = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // 1. 处理流式文本片段
          if (delta.content) {
            fullText += delta.content;
            if (onChunk) onChunk(delta.content);
          }

          // 2. 处理流式返回的工具调用（OpenAI 的工具调用在流中是分段拼接的）
          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;

              // 如果这个索引的工具调用还没初始化，先初始化
              if (!finalToolCalls[index]) {
                finalToolCalls[index] = {
                  id: toolCallDelta.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }

              // 拼接工具名
              if (toolCallDelta.function?.name) {
                finalToolCalls[index].function.name += toolCallDelta.function.name;
              }
              // 拼接参数字符串
              if (toolCallDelta.function?.arguments) {
                finalToolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }

        // 过滤掉可能存在的空数据
        const validToolCalls = finalToolCalls.filter(tc => tc && tc.function.name);

        if (finalMeta && onMeta) onMeta(finalMeta);

        return {
          text: fullText,
          toolCalls: validToolCalls.length > 0 ? validToolCalls : undefined,
          stopReason: validToolCalls.length > 0 ? 'tool_use' : 'stop',
        };

      } catch (error: any) {
        // 用户取消操作 —— 静默透传，不重试不日志
        if (error?.name === 'AbortError' || error?.message === 'CANCELLED') {
          throw error;
        }

        lastError = error;

        if (attempt < MAX_RETRIES && isTransientError(error)) {
          const delay = RETRY_DELAYS_MS[attempt];
          console.error(MSG_API_RETRY(attempt, MAX_RETRIES, delay / 1000));
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // retry
        }

        // Non-transient or out of retries — give up
        console.error(MSG_API_ERROR, error);
        throw error;
      }
    }

    throw lastError;
  }
}
