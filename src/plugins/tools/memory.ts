import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NanoPlugin, PluginRegistry, LLMResponse } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';
import { ChatMessage } from '../../llm.js';

// ── Memory storage types ──

interface MemoryItem {
  id: string;
  timestamp: string;
  content: string;
  tags: string[];
  role: 'user' | 'assistant' | 'system';
}

interface MemoryStore {
  memories: MemoryItem[];
}

// ── Storage helpers ──

function getStorageDir(baseDir: string, namespace: string): string {
  const dir = path.join(baseDir, namespace);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(baseDir: string, namespace: string): string {
  return path.join(getStorageDir(baseDir, namespace), 'store.json');
}

function loadStore(baseDir: string, namespace: string): MemoryStore {
  try {
    const raw = fs.readFileSync(getStorePath(baseDir, namespace), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { memories: [] };
  }
}

function saveStore(baseDir: string, namespace: string, store: MemoryStore): void {
  fs.writeFileSync(getStorePath(baseDir, namespace), JSON.stringify(store, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Plugin ──

export interface MemoryPluginConfig {
  namespace?: string;     // 记忆存储的命名空间（如 "treehole"）
  maxMemories?: number;    // 最大记忆条目数 (默认 200)
  recallLimit?: number;    // 召回时最多返回条数 (默认 10)
  baseDir?: string;        // 存储根目录（默认 ~/.nano-code/memory）
}

export function createMemoryPlugin(config?: MemoryPluginConfig): NanoPlugin {
  const cfg = {
    namespace: config?.namespace ?? 'default',
    maxMemories: config?.maxMemories ?? 200,
    recallLimit: config?.recallLimit ?? 10,
    baseDir: config?.baseDir ?? path.join(os.homedir(), '.nano-code', 'memory'),
  };

  return {
    name: 'memory',
    description: 'Persistent memory storage and recall for multi-session conversations',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'save_memory',
            description: '保存一条记忆。用于记录重要的用户信息、关键事实、情感状态等，以便在后续对话中引用。',
            parameters: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '记忆内容' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '标签列表，用于分类和检索（如 ["情感", "家庭", "工作"]）',
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
            description: '检索相关记忆。根据查询词找到最相关的历史记忆，用于在对话中恢复上下文。',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: '查询关键词，用于匹配记忆内容和标签',
                },
                limit: {
                  type: 'number',
                  description: '最多返回多少条记忆（默认 10）',
                },
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
        case 'save_memory': {
          if (!args.content) {
            return { status: 'error', message: '记忆内容不能为空' };
          }
          const store = loadStore(cfg.baseDir, cfg.namespace);
          const item: MemoryItem = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            content: args.content,
            tags: args.tags ?? [],
            role: 'user',
          };
          store.memories.push(item);
          // Trim oldest if over limit
          if (store.memories.length > cfg.maxMemories) {
            store.memories = store.memories.slice(-cfg.maxMemories);
          }
          saveStore(cfg.baseDir, cfg.namespace, store);
          return {
            status: 'success',
            data: `记忆已保存 (id: ${item.id})`,
          };
        }

        case 'recall_memory': {
          if (!args.query) {
            return { status: 'error', message: '查询词不能为空' };
          }
          const store = loadStore(cfg.baseDir, cfg.namespace);
          const query = args.query.toLowerCase();
          const limit = args.limit ?? cfg.recallLimit;

          // Simple keyword matching: score by tag match + content match
          const scored = store.memories.map(m => {
            let score = 0;
            // Tag match
            for (const tag of m.tags) {
              if (query.includes(tag.toLowerCase())) score += 3;
            }
            // Content match
            if (m.content.toLowerCase().includes(query)) score += 2;
            // Recency bonus (normalized to 0-1)
            const age = Date.now() - new Date(m.timestamp).getTime();
            const recency = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)); // 30-day decay
            score += recency;
            return { ...m, score };
          });

          const results = scored
            .filter(m => m.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ score, ...m }) => m); // strip score from output

          if (results.length === 0) {
            return {
              status: 'success',
              data: '没有找到相关的记忆。',
            };
          }

          return {
            status: 'success',
            data: JSON.stringify(results, null, 2),
          };
        }

        default:
          return { status: 'error', message: `未知工具: ${name}` };
      }
    },

    async onInit(registry: PluginRegistry): Promise<void> {
      // Load config from registry
      const registryConfig = registry.getPluginConfig('memory') as MemoryPluginConfig;
      if (registryConfig.namespace) cfg.namespace = registryConfig.namespace;
      if (registryConfig.maxMemories) cfg.maxMemories = registryConfig.maxMemories;
      if (registryConfig.recallLimit) cfg.recallLimit = registryConfig.recallLimit;

      // Ensure storage directory exists
      getStorageDir(cfg.baseDir, cfg.namespace);
    },

    onAfterRequest(response: LLMResponse): void {
      // Auto-save user messages from the response context
      // The actual user content is already in message history, saved by the session system.
      // This hook is available for future auto-summarization.
    },
  };
}
