import type { ToolDefinition } from '#src/core/contract.js';
import { getToolDisplayName } from '#src/utils/tool-name.js';
export { getToolDisplayName };

/**
 * Tools whose large content fields should always be skipped in args preview.
 */
const BIG_FIELDS = new Set([
  'content', 'old_string', 'new_string',
  'fileContent', 'fileContents', 'originalFile', 'replace',
]);

/**
 * Build a concise args preview string for display.
 *
 * Rules:
 * - Single non-BIG field → show value only (no key label)
 * - Multiple non-BIG fields → key=value pairs
 * - BIG fields (content, old_string, etc.) are always skipped
 */
export function getToolArgsPreview(args: any): string | null {
  if (!args || typeof args !== 'object') return null;

  const truncVal = (v: string, max = 80): string =>
    v.length > max ? v.slice(0, max) + '…' : v;

  const pickKeys = (keys: string[]): string | null => {
    const parts: string[] = [];
    for (const k of keys) {
      const v = args[k];
      if (v !== undefined && v !== null) {
        parts.push(typeof v === 'string' ? truncVal(v) : String(v));
      }
    }
    return parts.length > 0 ? parts.join(', ') : null;
  };

  // pattern/glob search tools — check before path since path is optional secondary param
  if (args.pattern) return pickKeys(['pattern', 'path']);
  if (args.glob) return pickKeys(['glob', 'path']);

  // path/file_path based tools (Read, Write, Patch, etc.)
  if (args.path !== undefined || args.file_path !== undefined) {
    const pathArg = args.path ?? args.file_path;
    const rest: string[] = [];
    for (const k of Object.keys(args)) {
      if (k === 'path' || k === 'file_path' || BIG_FIELDS.has(k)) continue;
      const v = args[k];
      if (typeof v === 'string') rest.push(`${k}=${v}`);
      else rest.push(`${k}=${JSON.stringify(v)}`);
    }
    const pathPart = truncVal(pathArg);
    return rest.length > 0 ? `${pathPart}, ${rest.join(', ')}` : pathPart;
  }

  // content-based tools (no path)
  if (args.content !== undefined) {
    const parts: string[] = [];
    for (const k of Object.keys(args)) {
      if (k === 'content') continue;
      parts.push(`${k}=${typeof args[k] === 'string' ? args[k] : JSON.stringify(args[k])}`);
    }
    return parts.length > 0 ? parts.join(', ') : pickKeys(['content']);
  }

  // command — show value only (single param, no label)
  if (args.command) return truncVal(args.command);

  if (args.url) return pickKeys(['url']);

  // Generic fallback: collect non-BIG entries
  const entries: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(args)) {
    if (BIG_FIELDS.has(k) || v === undefined || v === null) continue;
    entries.push({ key: k, value: typeof v === 'string' ? truncVal(v) : JSON.stringify(v) });
  }
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].value;
  return entries.map(e => `${e.key}=${e.value}`).join(', ');
}

/**
 * Full formatted tool call string for display.
 * E.g., "Bash(npm run build)" or "Read(src/index.ts)"
 */
export function formatToolCall(toolName: string, args: any, definitions?: ToolDefinition[]): string {
  const displayName = getToolDisplayName(toolName, definitions);

  // Non-object or null: show as value
  if (!args || typeof args !== 'object') {
    return `🔧 ${displayName}(${JSON.stringify(args)})`;
  }

  // Empty object/array: no args to show
  if (Object.keys(args).length === 0) {
    return `🔧 ${displayName}()`;
  }

  const preview = getToolArgsPreview(args);
  if (preview) {
    return `🔧 ${displayName}(${preview})`;
  }

  const str = JSON.stringify(args);
  const MAX_LEN = 200;
  if (str.length > MAX_LEN) {
    return `🔧 ${displayName}(${str.slice(0, MAX_LEN)}…)`;
  }
  return `🔧 ${displayName}(${str})`;
}
