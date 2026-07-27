/** 格式化耗时：Xs / Xm Ys / Xh Ym Zs */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 格式化 token 数：< 1000 显示 "N tokens"，≥ 1000 显示 "N.K tokens" */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  return `${(n / 1000).toFixed(1)}K tokens`;
}
