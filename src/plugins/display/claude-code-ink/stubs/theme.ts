// Minimal Theme type stub for CC design-system compatibility
export type ThemeName = 'dark' | 'light' | 'auto';
export type ThemeSetting = ThemeName;

export interface Theme {
  foreground: string;
  background: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  dim: string;
  inactive: string;
  codeBackground: string;
  userMessage: string;
  assistantMessage: string;
  toolMessage: string;
}

const darkTheme: Theme = {
  foreground: '#e0e0e0',
  background: '#1a1a2e',
  accent: '#7c3aed',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  dim: '#6b7280',
  inactive: '#6b7280',
  codeBackground: '#111827',
  userMessage: '#93c5fd',
  assistantMessage: '#a78bfa',
  toolMessage: '#fbbf24',
};

export function getTheme(_name?: ThemeName): Theme {
  return darkTheme;
}
