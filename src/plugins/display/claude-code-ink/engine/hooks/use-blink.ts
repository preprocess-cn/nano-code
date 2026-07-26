import { useAnimationFrame } from '#src/plugins/display/claude-code-ink/engine/hooks/use-animation-frame.js';

const BLINK_INTERVAL_MS = 600;

/**
 * Hook for synchronized blinking animations.
 *
 * 所有实例共享同一个动画时钟，因此它们同步闪烁。
 * 时钟仅在至少一个订阅者可见时运行。
 * 禁用时（enabled=false），始终返回 isVisible=true（静态显示）。
 *
 * @param enabled - 是否启用闪烁
 * @param intervalMs - 闪烁周期（毫秒），默认 600ms（即 300ms 可见 + 300ms 隐藏）
 * @returns [ref, isVisible] — ref 绑定到元素，isVisible=true 表示当前处于显示半周期
 */
export function useBlink(
  enabled: boolean,
  intervalMs: number = BLINK_INTERVAL_MS,
): [ref: (element: any | null) => void, isVisible: boolean] {
  const [ref, time] = useAnimationFrame(enabled ? intervalMs : null);

  if (!enabled) return [ref, true];

  const isVisible = Math.floor(time / intervalMs) % 2 === 0;
  return [ref, isVisible];
}