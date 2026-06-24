/**
 * 流式 think 标签过滤器。
 *
 * 规则：看到 </think> 之前的内容全部为推理内容（丢弃），之后的内容全部为可见输出。
 * 无论是否有配对的 <think> 开标签都能正确处理（兼容工具调用场景下模型
 * 只发 </think> 闭标签的行为）。
 *
 * 累积 buffer 自动处理 </think> 跨 chunk 分裂的情况。
 */
export class ThinkStream {
  private buffer = '';
  private passedThinkClose = false;

  /** 输入一个 chunk，返回该 chunk 中应向用户展示的可见文本。 */
  next(chunk: string): string {
    if (this.passedThinkClose) return chunk;

    this.buffer += chunk;
    const idx = this.buffer.indexOf('</think>');
    if (idx !== -1) {
      this.passedThinkClose = true;
      const visible = this.buffer.slice(idx + 8);
      this.buffer = '';
      return visible;
    }
    return '';
  }

  /** 重置状态（用于重新开始过滤一段新的流）。 */
  reset(): void {
    this.buffer = '';
    this.passedThinkClose = false;
  }
}
