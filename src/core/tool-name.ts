import type { ToolDefinition } from '#src/core/contract.js';

/**
 * Tools whose large content fields should always be skipped in args preview.
 */
const BIG_FIELDS = new Set([
  'content', 'old_string', 'new_string',
  'fileContent', 'fileContents', 'originalFile', 'replace',
]);

/**
 * Built-in tool name → display name mapping.
 * These are the fallback; tool definitions with explicit displayName take priority.
 */
const BUILTIN_DISPLAY_NAMES: Record<string, string> = {
  'run_bash_command': 'Bash',
  'view_file_content': 'Read',
  'write_file_content': 'Write',
  'patch_file': 'Patch',
  'list_project_files': 'List',
  'glob_files': 'Glob',
  'grep_file_content': 'Grep',
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Resolve a user-friendly display name for a tool.
 *
 * Priority:
 * 1. Tool definition's explicit `displayName` (from plugin registry)
 * 2. Built-in internal mapping
 * 3. `agent-xxx` → `Xxx`
 * 4. snake_case → Title Case
 */
export function getToolDisplayName(toolName: string, definitions?: ToolDefinition[]): string {
  // 1. Check registered definitions
  if (definitions) {
    for (const def of definitions) {
      if (def.function.name === toolName && def.function.displayName) {
        return def.function.displayName;
      }
    }
  }

  // 2. Built-in mapping
  if (BUILTIN_DISPLAY_NAMES[toolName]) {
    return BUILTIN_DISPLAY_NAMES[toolName];
  }

  // 3. Agent tools: agent-xxx → Xxx
  if (toolName.startsWith('agent-')) {
    return toolName.slice(6).split('-').map(capitalize).join(' ');
  }

  // 4. Fallback: snake_case → Title Case
  return toolName.split('_').map(capitalize).join(' ');
}
