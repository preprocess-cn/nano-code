import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { NanoPlugin } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';

// ── Simple glob implementation ──

function patternToRegex(pattern: string): RegExp {
  let src = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any depth
        i++; // skip next *
        if (pattern[i + 1] === '/') i++; // skip following /
        src += '(?:.+/)?';
      } else {
        src += '[^/]*';
      }
    } else if (ch === '?') {
      src += '[^/]';
    } else if (ch === '.') {
      src += '\\.';
    } else {
      src += ch;
    }
  }
  src += '$';
  return new RegExp(src);
}

interface GlobOptions {
  cwd?: string;
  ignore?: string[];
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', '.DS_Store'];

async function simpleGlob(pattern: string, options?: GlobOptions): Promise<string[]> {
  const cwd = path.resolve(options?.cwd || process.cwd());
  const ignore = new Set([...DEFAULT_IGNORE, ...(options?.ignore || [])]);

  // Extract directory prefix (e.g. "src/" from "src/**/*.ts") to narrow walk scope.
  // The prefix is a literal path segment before any wildcard.
  const firstWildcard = pattern.search(/[*?]/);
  const slashBeforeWildcard = firstWildcard >= 0 ? pattern.lastIndexOf('/', firstWildcard) : -1;
  const dirPrefix = slashBeforeWildcard >= 0 ? pattern.slice(0, slashBeforeWildcard) : '';
  const filePattern = dirPrefix ? pattern.slice(slashBeforeWildcard + 1) : pattern;

  const walkDir = dirPrefix ? path.resolve(cwd, dirPrefix) : cwd;

  // If the directory prefix doesn't exist, return empty
  try { await fs.access(walkDir); } catch { return []; }

  const regex = patternToRegex(filePattern);
  const results: string[] = [];

  async function walk(dir: string, relativeDir: string): Promise<void> {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs: string[] = [];

    for (const entry of entries) {
      // Skip exact matches in the ignore set
      if (ignore.has(entry.name)) continue;
      // Skip files with suffix-lock extensions (yarn.lock, Gemfile.lock, etc.)
      if (entry.name.endsWith('.lock')) continue;
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        dirs.push(entry.name);
      }
      if (regex.test(relPath)) {
        // Re-attach the directory prefix so results are relative to cwd
        results.push(dirPrefix ? `${dirPrefix}/${relPath}` : relPath);
      }
    }

    // Recurse into directories
    for (const dirName of dirs) {
      await walk(path.join(dir, dirName), relativeDir ? `${relativeDir}/${dirName}` : dirName);
    }
  }

  await walk(walkDir, '');
  return results;
}

// ── Grep implementation ──

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

async function grepContent(pattern: string, glob?: string, cwd?: string): Promise<GrepMatch[]> {
  const root = cwd || process.cwd();
  let searchRegex: RegExp;

  try {
    searchRegex = new RegExp(pattern, 'im');
  } catch {
    // fallback: case-insensitive string search
    const lower = pattern.toLowerCase();
    searchRegex = new RegExp(lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'im');
  }

  // Determine which files to search
  let filePaths: string[];
  if (glob) {
    filePaths = await simpleGlob(glob, { cwd: root });
  } else {
    filePaths = await simpleGlob('**/*', { cwd: root });
  }

  // Filter to only search text files (skip binary)
  const textExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.html', '.css',
    '.scss', '.less', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
    '.swift', '.kt', '.scala', '.ex', '.exs', '.elm', '.clj', '.cljs',
    '.php', '.pl', '.pm', '.r', '.m', '.mm',
    '.vue', '.svelte', '.astro', '.graphql', '.gql',
    '.xml', '.svg', '.sql', '.env', '.gitignore', '.dockerignore',
    '.eslintrc', '.prettierrc', '.babelrc', '.npmrc',
    '.lock', '.patch', '.diff',
  ]);

  const results: GrepMatch[] = [];

  for (const filePath of filePaths) {
    const ext = path.extname(filePath);
    if (!textExtensions.has(ext) && ext !== '') continue;
    if (filePath.includes('node_modules') || filePath.includes('.git')) continue;

    const fullPath = path.resolve(root, filePath);
    let content: string;
    try {
      content = fsSync.readFileSync(fullPath, 'utf-8');
    } catch {
      continue; // skip binary or unreadable files
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (searchRegex.test(lines[i])) {
        results.push({
          file: filePath,
          line: i + 1,
          content: lines[i].trim(),
        });
      }
    }
  }

  return results;
}

// ── Tool descriptions ──

const toolError = (msg: string): ToolResponse => ({ status: 'error', message: msg });

export const searchPlugin: NanoPlugin = {
  name: 'search',
  description: 'File and content search tools (glob, grep)',
  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'glob_files',
          description: 'Search for files matching a glob pattern. Supports ** (recursive), * (single segment), and ? (single char). Examples: "**/*.ts" finds all TypeScript files, "src/**/*.css" finds all CSS files under src/, "*.json" finds JSON files in root. Results sorted for consistency.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.css", "*.json")' },
              ignore: { type: 'string', description: 'Comma-separated additional directory/file names to ignore (e.g., "build,coverage")' },
            },
            required: ['pattern'],
          },
          sideEffect: false,
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep_file_content',
          description: 'Search for a pattern across file contents. Returns matching files with line numbers and line content. Supports regex patterns and optional glob to narrow search scope. To search for a plain string, use case-insensitive matching.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Search pattern (regex or plain text, case-insensitive)' },
              glob: { type: 'string', description: 'Optional glob to narrow which files to search (e.g., "src/**/*.ts" to only search TypeScript files under src/)' },
              maxResults: { type: 'number', description: 'Maximum number of match results to return (default 50)' },
            },
            required: ['pattern'],
          },
          sideEffect: false,
        },
      },
    ];
  },

  async execute(name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case 'glob_files': {
        try {
          if (!args.pattern) return toolError('args.pattern missing, please provide a glob pattern');
          const ignore = args.ignore ? args.ignore.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
          const files = await simpleGlob(args.pattern, { ignore });
          if (files.length === 0) {
            return { status: 'success', data: `No files matched pattern "${args.pattern}".` };
          }
          const result = files.sort().map(f => `- ${f}`).join('\n');
          return { status: 'success', data: `Found ${files.length} file(s) matching "${args.pattern}":\n${result}` };
        } catch (err: any) {
          return toolError(`glob_files failed: ${err.message}`);
        }
      }

      case 'grep_file_content': {
        try {
          if (!args.pattern) return toolError('args.pattern missing, please provide a search pattern');
          const maxResults = args.maxResults ?? 50;
          const matches = await grepContent(args.pattern, args.glob);
          if (matches.length === 0) {
            return { status: 'success', data: `No matches found for pattern "${args.pattern}".` };
          }
          const limited = matches.slice(0, maxResults);
          const lines = limited.map(m => `${m.file}:${m.line}: ${m.content}`);
          const summary = `Found ${matches.length} match(es) for "${args.pattern}"${args.glob ? ` in ${args.glob}` : ''}:\n${lines.join('\n')}`;
          return { status: 'success', data: summary };
        } catch (err: any) {
          return toolError(`grep_file_content failed: ${err.message}`);
        }
      }

      default:
        throw new Error(`Unknown search tool: ${name}`);
    }
  },
};
