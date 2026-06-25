/**
 * 解析以 / 或 ! 开头的用户输入为命令名和参数。
 */

export interface ParsedCommand {
  name: string;
  args: string;
  prefix: '/' | '!';
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('!')) return null;

  const prefix = trimmed[0] as '/' | '!';
  const rest = trimmed.slice(1).trim();
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx === -1) return { name: rest, args: '', prefix };
  return { name: rest.slice(0, spaceIdx), args: rest.slice(spaceIdx + 1).trim(), prefix };
}
