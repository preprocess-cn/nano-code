/**
 * 流式 think 标签过滤器。
 *
 * 规则：看到 </think> 之前的内容全部为推理内容（丢弃），之后的内容全部为可见输出。
 * 无论是否有配对的 <think> 开标签都能正确处理（兼容工具调用场景下模型
 * 只发 </think> 闭标签的行为）。
 *
 * 兜底机制：如果 buffer 中没有任何 think 标签（<think> 或 </think>），
 * 且积累超过阈值，则认为该模型不使用 think 标签，直接放行全部内容。
 * 这解决了多轮 LLM 调用中（如子 agent 返回后主 agent 继续生成），
 * 第二轮响应可能不包含 </think> 导致全部输出被丢弃的问题。
 *
 * 累积 buffer 自动处理 </think> 跨 chunk 分裂的情况。
 */
export class ThinkStream {
  private buffer = '';
  private passedThinkClose = false;
  private hasSeenThinkTag = false;
  /** 兜底阈值：buffer 超过此大小且无任何 think 标签，视为无 think 模式 */
  private static PASS_THROUGH_THRESHOLD = 4096;

  /** 输入一个 chunk，返回该 chunk 中应向用户展示的可见文本。 */
  next(chunk: string): string {
    if (this.passedThinkClose) return chunk;

    this.buffer += chunk;

    // 检测是否有任何 think 标签
    if (!this.hasSeenThinkTag) {
      if (this.buffer.includes('<think>') || this.buffer.includes('</think>')) {
        this.hasSeenThinkTag = true;
      }
    }

    const idx = this.buffer.indexOf('</think>');
    if (idx !== -1) {
      this.passedThinkClose = true;
      const visible = this.buffer.slice(idx + 8);
      this.buffer = '';
      return visible;
    }

    // 兜底：buffer 超过阈值且从未见过任何 think 标签 → 放行全部
    if (!this.hasSeenThinkTag && this.buffer.length > ThinkStream.PASS_THROUGH_THRESHOLD) {
      this.passedThinkClose = true;
      const result = this.buffer;
      this.buffer = '';
      return result;
    }

    return '';
  }

  /** 重置状态（用于重新开始过滤一段新的流）。 */
  reset(): void {
    this.buffer = '';
    this.passedThinkClose = false;
    this.hasSeenThinkTag = false;
  }
}
