/**
 * 流式 <think> 标签过滤器。
 *
 * 维护一个跨 chunk 的状态机，将 <think>...</think> 之间的推理内容剥离，
 * 只返回应向用户展示的可见文本。
 *
 * 使用方式：
 *   const filter = new ThinkStream();
 *   for (const chunk of stream) {
 *     const visible = filter.next(chunk);
 *     if (visible) process.stdout.write(visible);
 *   }
 */
export class ThinkStream {
  private buffer = '';
  private insideThink = false;

  /** 输入一个 chunk，返回该 chunk 中应向用户展示的可见文本。 */
  next(chunk: string): string {
    if (!chunk) return '';
    this.buffer += chunk;
    let output = '';

    while (this.buffer) {
      if (this.insideThink) {
        const closeIdx = this.buffer.indexOf('</think>');
        if (closeIdx === -1) { this.buffer = ''; break; }
        this.insideThink = false;
        this.buffer = this.buffer.slice(closeIdx + 8);
        continue;
      }

      const openIdx = this.buffer.indexOf('<think>');
      if (openIdx !== -1) {
        output += this.buffer.slice(0, openIdx);
        this.insideThink = true;
        this.buffer = this.buffer.slice(openIdx + 7);
        continue;
      }
      output += this.buffer;
      this.buffer = '';
      break;
    }

    return output;
  }

  /** 重置状态（用于重新开始过滤一段新的流）。 */
  reset(): void {
    this.buffer = '';
    this.insideThink = false;
  }
}
