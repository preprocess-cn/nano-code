/** RGB 颜色或命名的 ANSI 颜色 */
export type Color =
  | { r: number; g: number; b: number }
  | string;

export interface Theme {
  /** 主前景色 */
  foreground: Color;
  /** 主背景色 */
  background: Color;
  /** 强调色（链接、活跃元素） */
  accent: Color;
  /** 成功/完成 */
  success: Color;
  /** 警告 */
  warning: Color;
  /** 错误 */
  error: Color;
  /** 次要文本（副信息、时间戳） */
  dim: Color;
  /** 代码块背景 */
  codeBackground: Color;
  /** 用户消息 */
  userMessage: Color;
  /** AI 消息 */
  assistantMessage: Color;
  /** 工具调用信息 */
  toolMessage: Color;
}

export const darkTheme: Theme = {
  foreground: '#e0e0e0',
  background: '#1a1a2e',
  accent: '#7c3aed',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  dim: '#6b7280',
  codeBackground: '#111827',
  userMessage: '#93c5fd',
  assistantMessage: '#a78bfa',
  toolMessage: '#fbbf24',
};

export const lightTheme: Theme = {
  foreground: '#1f2937',
  background: '#ffffff',
  accent: '#7c3aed',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  dim: '#9ca3af',
  codeBackground: '#f3f4f6',
  userMessage: '#2563eb',
  assistantMessage: '#7c3aed',
  toolMessage: '#d97706',
};
