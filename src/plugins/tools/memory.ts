import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';
import { SK } from '#src/core/store-keys.js';

// ── Config ──

export interface MemoryPluginConfig {
  /** 记忆行为规则注入 system prompt（默认 true） */
  injectMemoryRules?: boolean;
  /** MEMORY.md 索引注入 system prompt（默认 true） */
  injectMemoryIndex?: boolean;
  /** ~/.nano-code/AGENT.md 用户全局文件注入（默认 true） */
  injectUserGlobal?: boolean;
  /** MEMORY.md 最大行数（默认 200） */
  indexLineLimit?: number;
  /** MEMORY.md 最大字节数（默认 25600） */
  indexByteLimit?: number;
}

// ── Defaults ──

const DEFAULTS = {
  injectMemoryRules: true,
  injectMemoryIndex: true,
  injectUserGlobal: true,
  indexLineLimit: 200,
  indexByteLimit: 25600,
  recallLimit: 10,
} as const;

// ── Memory rules prompt (injected into system prompt) ──

export const MEMORY_RULES_PROMPT = `## Memory System

You have a persistent, file-based memory system for recalling information across sessions.

### When to Save

Save a memory when:
- The user shares their preferences, role, or project context
- The user explicitly says "remember this" or "save this"
- You discover non-obvious facts about the project that would help future sessions
- The user gives you corrections or confirms a specific approach works

Use \`save_memory\` with appropriate \`tags\` to categorize.

### When NOT to Save

- Code structure visible in the file tree (that's what reading files is for)
- Transient task state or current conversation progress
- Secrets, passwords, API keys
- Generic programming knowledge derivable from language docs

### When to Recall

Read relevant memories when:
- The user references prior conversations or previously discussed topics
- The answer depends on user preferences you may have learned
- The user says "as I said before", "remember when", or similar
- Starting a task that may relate to saved project context

Use \`recall_memory\` with relevant keywords to find saved memories.`;

// ── Path resolution ──

function sanitizeProjectPath(absPath: string): string {
  return path.resolve(absPath)
    .replace(/[/\\]/g, '+')
    .replace(/[^a-zA-Z0-9_\-+.@]/g, '_');
}

let _cachedProjectDir: string | null = null;

/** Project-specific memory directory: ~/.nano-code/projects/<sanitized-cwd>/ */
function getProjectDir(): string {
  if (!_cachedProjectDir) {
    _cachedProjectDir = path.join(os.homedir(), '.nano-code', 'projects', sanitizeProjectPath(process.cwd()));
  }
  return _cachedProjectDir;
}

/** Directory for topic files: <projectDir>/memories/ */
function getMemoriesDir(): string {
  return path.join(getProjectDir(), 'memories');
}

/** MEMORY.md index path: <projectDir>/MEMORY.md */
function getIndexPath(): string {
  return path.join(getProjectDir(), 'MEMORY.md');
}

/** User-global AGENT.md path: ~/.nano-code/AGENT.md */
function getUserGlobalPath(): string {
  return path.join(os.homedir(), '.nano-code', 'AGENT.md');
}

// ── Index file operations ──

interface IndexEntry {
  title: string;
  file: string;
  hook: string;
}

/** Parse a single MEMORY.md index line. Format: - [Title](file.md) — Hook */
function parseIndexLine(line: string): IndexEntry | null {
  const m = line.match(/^-\s*\[(.+?)\]\((.+?)\)\s*[—–-]\s*(.+)$/);
  if (!m) return null;
  return { title: m[1].trim(), file: m[2].trim(), hook: m[3].trim() };
}

function readIndex(indexPath: string): IndexEntry[] {
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return raw.split('\n').map(l => parseIndexLine(l)).filter(Boolean) as IndexEntry[];
  } catch {
    return [];
  }
}

function readIndexRaw(indexPath: string): string {
  try {
    return fs.readFileSync(indexPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

/** Append a new entry to MEMORY.md, enforcing caps. Returns the entry line. */
function appendIndexEntry(
  indexPath: string, title: string, file: string, hook: string,
  lineLimit: number, byteLimit: number,
): string {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const newLine = `- [${title}](${file}) — ${hook}`;

  let existing = '';
  try { existing = fs.readFileSync(indexPath, 'utf-8'); } catch { /* new file */ }

  const lines = existing.trim() ? existing.trim().split('\n') : [];
  lines.push(newLine);

  // Cap by line count: drop oldest if over limit (keep the new entry)
  if (lines.length > lineLimit) {
    const dropped = lines.length - lineLimit;
    lines.splice(0, dropped);
    lines.push('');
    lines.push(`> WARNING: MEMORY.md line limit (${lineLimit}) reached. Dropped ${dropped} old entr${dropped > 1 ? 'ies' : 'y'}.`);
  }

  // Cap by byte count (buffer-level truncation — correct for multi-byte content)
  let output = lines.join('\n');
  if (Buffer.byteLength(output, 'utf-8') > byteLimit) {
    const buf = Buffer.from(output);
    const truncated = buf.slice(0, byteLimit);
    const lastNewline = truncated.lastIndexOf(10); // byte 0x0A = '\n'
    output = truncated.slice(0, lastNewline > 0 ? lastNewline : truncated.length).toString();
  }

  fs.writeFileSync(indexPath, output + '\n', 'utf-8');
  return newLine;
}

// ── Topic file operations ──

/** Simple front-matter parser. Returns parsed metadata and body. */
function parseFrontMatter(content: string): { tags: string[]; created: string; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { tags: [], created: '', body: content.trim() };

  let tags: string[] = [];
  let created = '';
  for (const line of m[1].split('\n')) {
    if (line.startsWith('tags:')) {
      const val = line.slice(5).trim();
      try { tags = JSON.parse(val.replace(/'/g, '"')); } catch {
        tags = val.replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      }
    } else if (line.startsWith('created:')) {
      created = line.slice(8).trim();
    }
  }
  return { tags, created, body: m[2].trim() };
}

function writeTopicFile(dir: string, filename: string, content: string, tags: string[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const created = new Date().toISOString();
  const fm = `---\ntags: ${JSON.stringify(tags)}\ncreated: ${created}\n---\n\n`;
  fs.writeFileSync(path.join(dir, filename), fm + content.trim() + '\n', 'utf-8');
}

function readTopicFile(dir: string, filename: string): { content: string; tags: string[]; created: string } | null {
  try {
    const raw = fs.readFileSync(path.join(dir, filename), 'utf-8');
    const { tags, created, body } = parseFrontMatter(raw);
    return { content: body, tags, created };
  } catch {
    return null;
  }
}

/** Generate a safe filename from a string. */
function safeFilename(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (slug) return slug;
  // Fallback for purely non-alphanumeric titles — random suffix avoids collision
  return `memory-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Plugin ──

export function createMemoryPlugin(config?: MemoryPluginConfig): NanoPlugin {
  const cfg = { ...DEFAULTS, ...config };

  return {
    name: 'memory',
    description: 'Persistent file-based memory storage and recall',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'save_memory',
            description: '保存一条记忆，用于跨会话持久化用户偏好、项目事实等。保存后会自动加入 MEMORY.md 索引。',
            parameters: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '记忆内容，建议简洁完整' },
                title: { type: 'string', description: '可选的标题，用于索引和检索。省略时从内容自动生成。' },
                tags: {
                  type: 'array', items: { type: 'string' },
                  description: '标签列表，用于分类和检索（如 ["preference", "architecture"]）',
                },
              },
              required: ['content'],
            },
            sideEffect: true,
          },
        },
        {
          type: 'function',
          function: {
            name: 'recall_memory',
            description: '根据关键词检索已保存的记忆。查找 MEMORY.md 索引后加载对应的完整内容。',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '关键词，匹配标题和描述' },
                tags: {
                  type: 'array', items: { type: 'string' },
                  description: '可选：按标签过滤记忆',
                },
                limit: { type: 'number', description: '最多返回条数（默认 10）' },
              },
              required: ['query'],
            },
            sideEffect: false,
          },
        },
      ];
    },

    async execute(name: string, args: any, _ctx: ToolContext): Promise<ToolResponse> {
      switch (name) {
        case 'save_memory':
          return handleSave(args, getMemoriesDir(), getIndexPath(), cfg.indexLineLimit, cfg.indexByteLimit);
        case 'recall_memory':
          return handleRecall(args, getMemoriesDir(), getIndexPath(), cfg.recallLimit);
        default:
          return { status: 'error', message: `未知工具: ${name}` };
      }
    },

    onSystemPrompt(prompt: string): string {
      const parts: string[] = [];

      // 1. Memory behavioral rules
      if (cfg.injectMemoryRules) {
        const projectDir = getProjectDir();
        parts.push(MEMORY_RULES_PROMPT);
        parts.push(`\nMemory directory: \`${projectDir}\` — write to it directly with the Write tool.`);
      }

      // 2. MEMORY.md index
      if (cfg.injectMemoryIndex) {
        const raw = readIndexRaw(getIndexPath());
        if (raw) {
          const lines = raw.split('\n');
          const capped = lines.slice(0, cfg.indexLineLimit).join('\n');
          if (Buffer.byteLength(capped, 'utf-8') <= cfg.indexByteLimit) {
            parts.push(`### MEMORY.md Index\n\n${capped}`);
          }
        }
      }

      // 3. User-global AGENT.md
      if (cfg.injectUserGlobal) {
        try {
          const content = fs.readFileSync(getUserGlobalPath(), 'utf-8').trim();
          if (content) {
            parts.push(`### Global User Preferences (from ~/.nano-code/AGENT.md)\n\n${content}`);
          }
        } catch { /* file doesn't exist */ }
      }

      if (parts.length === 0) return prompt;
      return prompt + '\n\n' + parts.join('\n\n');
    },

    onInit(registry: PluginRegistry): Promise<void> {
      // Compute and publish paths to shared store for other plugins (e.g. analyzer)
      registry.store.set(SK.MemoryProjectDir, getProjectDir());
      registry.store.set(SK.MemoryIndexPath, getIndexPath());
      registry.store.set(SK.MemoryUserGlobalPath, getUserGlobalPath());
      return Promise.resolve();
    },

    onDestroy(): Promise<void> {
      _cachedProjectDir = null;
      return Promise.resolve();
    },
  };
}

// ── Tool handlers ──

function handleSave(
  args: any, memoriesDir: string, indexPath: string, lineLimit: number, byteLimit: number,
): ToolResponse {
  if (!args.content) return { status: 'error', message: '记忆内容不能为空' };

  const title = (args.title || args.content).trim().slice(0, 80);
  const tags: string[] = args.tags ?? [];
  const filename = safeFilename(title) + '.md';
  const hook = args.content.trim().slice(0, 100).replace(/\n/g, ' ');

  // Dedupe: if same filename and title exists, update
  const existing = readIndex(indexPath);
  const dup = existing.find(e => e.file === filename || e.title === title);

  // Write topic file
  writeTopicFile(memoriesDir, filename, args.content, tags);

  // Update index
  if (dup) {
    // Re-write the whole index with cap enforcement (replace matching entry)
    const newEntries = existing.map(e =>
      (e.file === filename || e.title === title)
        ? { title, file: filename, hook }
        : e,
    );
    let lines = newEntries.map(e => `- [${e.title}](${e.file}) — ${e.hook}`);
    if (lines.length > lineLimit) {
      const dropped = lines.length - lineLimit;
      lines = lines.slice(dropped);
      lines.push('');
      lines.push(`> WARNING: MEMORY.md line limit (${lineLimit}) reached. Dropped ${dropped} old entr${dropped > 1 ? 'ies' : 'y'}.`);
    }
    let raw = lines.join('\n');
    if (Buffer.byteLength(raw, 'utf-8') > byteLimit) {
      const buf = Buffer.from(raw);
      const truncated = buf.slice(0, byteLimit);
      const lastNewline = truncated.lastIndexOf(10);
      raw = truncated.slice(0, lastNewline > 0 ? lastNewline : truncated.length).toString();
    }
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, raw + '\n', 'utf-8');
  } else {
    appendIndexEntry(indexPath, title, filename, hook, lineLimit, byteLimit);
  }

  return {
    status: 'success',
    data: `记忆已保存。索引: \`- [${title}](${filename})\``,
  };
}

function handleRecall(
  args: any, memoriesDir: string, indexPath: string, recallLimit: number,
): ToolResponse {
  const query = (args.query || '').toLowerCase();
  if (!query) return { status: 'error', message: '查询词不能为空' };
  const limit = args.limit ?? recallLimit;
  const filterTags: string[] = args.tags ?? [];

  const entries = readIndex(indexPath);
  if (entries.length === 0) {
    return { status: 'success', data: '还没有保存任何记忆。' };
  }

  // Score entries
  const scored = entries.map(e => {
    let score = 0;
    if (e.title.toLowerCase().includes(query)) score += 3;
    if (e.hook.toLowerCase().includes(query)) score += 2;

    // Load topic content for full-text search
    const topic = readTopicFile(memoriesDir, e.file);
    if (topic) {
      if (topic.content.toLowerCase().includes(query)) score += 2;
      // Tag filter: if filterTags provided, check match
      if (filterTags.length > 0) {
        const matchCount = filterTags.filter(t => topic.tags.some(tt => tt.toLowerCase().includes(t.toLowerCase()))).length;
        if (matchCount === 0) score = -1; // exclude
        else score += matchCount * 2;
      }
    }

    return { ...e, score, topic };
  });

  const results = scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => ({
      title: r.title,
      content: r.topic?.content || r.hook,
      file: r.file,
      tags: r.topic?.tags || [],
    }));

  if (results.length === 0) {
    return { status: 'success', data: '没有找到相关的记忆。' };
  }

  return { status: 'success', data: JSON.stringify(results, null, 2) };
}
