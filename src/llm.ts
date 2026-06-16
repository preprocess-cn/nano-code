import OpenAI from 'openai';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

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

  constructor(config?: LLMConfig) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('X 错误: 未能在环境变量中找到 OPENAI_API_KEY。请在 .env 文件中配置。');
      process.exit(1);
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
    onChunk?: (text: string) => void
  ) {
    // ── Retry loop with exponential backoff ──
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 请求 OpenAI 的流式接口
        const stream = await this.openai.chat.completions.create({
          model: this.model,
          messages: messages as any,
          stream: true,
          stream_options: { include_usage: true },
          temperature: this.temperature,
          // 只有当有工具传入时，才把 tools 参数加上
          tools: tools && tools.length > 0 ? tools : undefined,
        });

        let fullText = '';
        let finalToolCalls: any[] = [];
        let finalUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

        for await (const chunk of stream) {
          // Capture usage from the final chunk (present when stream_options.include_usage is true)
          if (chunk.usage) {
            finalUsage = chunk.usage;
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // [!] 联动修复：只要流开始吐数据了（哪怕是工具片段），就触发回调，通知 Agent 关掉 Spinner
          if ((delta.content || delta.tool_calls) && onChunk) {
            // 传入空字符串，主要目的是触发回调，执行外界的 stop 逻辑
            onChunk(delta.content || '');
          }

          // 1. 处理流式文本片段
          if (delta.content) {
            fullText += delta.content;
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

        return {
          text: fullText,
          toolCalls: validToolCalls.length > 0 ? validToolCalls : undefined,
          stopReason: validToolCalls.length > 0 ? 'tool_use' : 'stop',
          usage: finalUsage ? {
            promptTokens: finalUsage.prompt_tokens ?? 0,
            completionTokens: finalUsage.completion_tokens ?? 0,
            totalTokens: finalUsage.total_tokens ?? 0,
          } : undefined,
        };

      } catch (error) {
        lastError = error;

        if (attempt < MAX_RETRIES && isTransientError(error)) {
          const delay = RETRY_DELAYS_MS[attempt];
          console.error(`\n! API 请求失败（尝试 ${attempt + 1}/${MAX_RETRIES + 1}），${delay / 1000}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // retry
        }

        // Non-transient or out of retries — give up
        console.error('\nX 调用 OpenAI 兼容 API 时发生错误:', error);
        throw error;
      }
    }

    // Should never reach here (retry loop always either returns or throws)
    throw lastError;
  }
}
