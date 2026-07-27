import type { AgentContext, UIMessage } from './agent-context.js';
import { ThinkStream } from '#src/plugins/display/think-stream.js';

/**
 * 流式增量事件。对标 CC 的 stream_event delta。
 */
export interface StreamDelta {
  agentName: string;
  type: 'text_delta' | 'thinking_delta';
  text: string;
}

/**
 * 对标 CC handleMessageFromStream。
 * 处理 stream delta，管理流式文本的临时 overlay。
 *
 * - text_delta: 经过 ThinkStream 过滤后追加到 ctx.streamingText
 * - thinking_delta: 仅在 showThink 模式下展示为 thinking 消息
 * - 返回新的 UIMessage 列表（不可变模式），null 表示无变化无需重新渲染
 */
export function handleStreamDelta(
  delta: StreamDelta,
  ctx: AgentContext,
  thinkStream: ThinkStream,
  showThink: boolean,
): UIMessage[] | null {
  const { agentName, type, text } = delta;

  if (type === 'thinking_delta') {
    if (showThink) {
      const msgs = [...ctx.messages];
      const last = msgs[msgs.length - 1];
      if (last?.kind === 'thinking' && last.agentName === agentName) {
        msgs[msgs.length - 1] = { ...last, text: last.text + text };
      } else {
        msgs.push({
          agentName,
          text,
          kind: 'thinking',
        });
      }
      return msgs;
    }
    return null;
  }

  // text_delta: ThinkStream 过滤 think 标签
  const filtered = thinkStream.next(text);
  if (!filtered) return null;

  // 函数式追加流式文本
  ctx.streamingText.update(prev => (prev ?? '') + filtered);

  const currentStreaming = ctx.streamingText.get();
  if (currentStreaming === null) return null;

  // 合并流式文本到消息列表
  const msgs = [...ctx.messages];
  const last = msgs[msgs.length - 1];
  if (last?.kind === 'stream' && last.agentName === agentName) {
    msgs[msgs.length - 1] = { ...last, text: currentStreaming };
  } else {
    msgs.push({
      agentName,
      text: currentStreaming,
      kind: 'stream',
    });
  }

  return msgs;
}

/**
 * 清除指定 agent 的流式文本 overlay。
 * 对标 CC 的 onStreamingText(() => null)。
 */
export function clearStreamingText(ctx: AgentContext): void {
  ctx.streamingText.update(() => null);
}

/**
 * 提交流式文本：将 streamingText 的临时内容固化为最终消息文本。
 * 在 agent turn 结束或 content_block 切换时调用。
 */
export function commitStreamingText(ctx: AgentContext): UIMessage[] {
  const streaming = ctx.streamingText.get();
  if (!streaming) return ctx.messages;

  const msgs = [...ctx.messages];
  const last = msgs[msgs.length - 1];
  if (last?.kind === 'stream' && last.agentName === ctx.agentName) {
    msgs[msgs.length - 1] = { ...last, text: streaming };
  }

  clearStreamingText(ctx);
  return msgs;
}
