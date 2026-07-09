import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';

// ── Types ──

export interface AskQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskQuestionRequest {
  question: string;
  header: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
}

// ── Module-level registry reference ──

let _registry: PluginRegistry | null = null;

// ── Tool: ask_user_question ──

const TOOL_NAME = 'ask_user_question';

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: '在执行过程中向用户提问以收集偏好、澄清需求、获取决策或提供选择。最多同时问 4 个问题。每个问题可以附带 2-4 个选项，支持单选或多选。',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '向用户提出的问题（1-4 个）',
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description: '完整的提问内容，必须以问号结尾',
                },
                header: {
                  type: 'string',
                  description: '标签页标题，最长 12 个字符',
                },
                options: {
                  type: 'array',
                  description: '选项列表（2-4 个）',
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description: '选项显示文本（1-5 个单词）',
                      },
                      description: {
                        type: 'string',
                        description: '选项的详细说明或影响描述',
                      },
                      preview: {
                        type: 'string',
                        description: '选项预览内容（代码片段、布局示意图等）',
                      },
                    },
                    required: ['label', 'description'],
                  },
                  minItems: 2,
                  maxItems: 4,
                },
                multiSelect: {
                  type: 'boolean',
                  description: '是否允许多选（默认 false 为单选）',
                },
              },
              required: ['question', 'header', 'options'],
            },
            minItems: 1,
            maxItems: 4,
          },
        },
        required: ['questions'],
      },
      sideEffect: false,
      timeout: Infinity,
    },
  },
];

async function handleAskUserQuestion(args: any): Promise<ToolResponse> {
  const { questions } = args || {};
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return { status: 'error', message: '请提供至少一个问题。' };
  }
  if (questions.length > 4) {
    return { status: 'error', message: '一次最多只能问 4 个问题。' };
  }
  for (const q of questions) {
    if (!q.question || !q.header || !q.options || !Array.isArray(q.options)) {
      return { status: 'error', message: '每个问题必须包含 question、header 和 options。' };
    }
    if (q.options.length < 2 || q.options.length > 4) {
      return { status: 'error', message: '每个问题必须有 2-4 个选项。' };
    }
    if (q.header.length > 12) {
      return { status: 'error', message: 'header 最长 12 个字符。' };
    }
    if (!q.question.endsWith('？') && !q.question.endsWith('?')) {
      return { status: 'error', message: 'question 必须以问号结尾。' };
    }
  }

  // Try display-registered interactive handler first
  const handler = _registry?.getInteractiveHandler('ask_user_question');
  if (handler) {
    return handler(args);
  }

  // Fallback: no display handler registered — return structured data for the LLM to present
  return {
    status: 'success',
    data: `[交互式提问] 用户需要回答以下问题，请逐一呈现并等待回答：\n${JSON.stringify(questions, null, 2)}`,
  };
}

// ── Plugin export ──

export const askUserQuestionPlugin: NanoPlugin = {
  name: 'ask-user-question',
  description: 'AskUserQuestion 工具 — 向用户提问以澄清需求',

  getTools(): ToolDefinition[] {
    return TOOLS;
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case TOOL_NAME:
        return handleAskUserQuestion(args);
      default:
        throw new Error(`Unknown ask-user-question tool: ${name}`);
    }
  },

  async onInit(registry: PluginRegistry) {
    _registry = registry;
  },
};
