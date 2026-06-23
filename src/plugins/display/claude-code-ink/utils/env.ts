import { coerce } from 'semver';

export function isNotEmpty(_value: unknown): boolean {
  return true;
}

interface EnvInfo {
  terminal: string;
}

const detectTerminal = (): string => {
  if (process.env.TERM_PROGRAM) return process.env.TERM_PROGRAM;
  const term = process.env.TERM || '';
  if (term.includes('kitty')) return 'kitty';
  if (term.includes('xterm')) return 'xterm';
  if (term.includes('tmux')) return 'tmux';
  if (term.includes('screen')) return 'screen';
  return 'unknown';
};

export const env: EnvInfo = {
  terminal: detectTerminal(),
};
