/**
 * general-purpose-definition.ts
 *
 * General-purpose agent — 通用子 agent，对应 skills 中 handleRunAgent 的功能。
 * 具备完整读写能力，可执行代码审查、批量修改等任务。
 */

import { AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';

export const GENERAL_PURPOSE_AGENT_NAME = 'general-purpose' as const;

const WITH_TOOLS_TEMPLATE = `你是 {role}。

可用工具：{tool_list}

你可以使用上述工具执行各种任务，包括搜索代码、读取文件、创建和修改文件、运行命令等。

在报告中使用简体中文。`;

export const GENERAL_PURPOSE_AGENT_DEF: AgentDefinition = {
  name: GENERAL_PURPOSE_AGENT_NAME,
  description: '通用助手，可以执行代码审查、批量修改、分析等各种任务。具有完整的读写能力。',
  role: '一个通用助手，可以执行各种任务',

  plugins: {
    fs: {},
    'file-search': {},
    command: {},
    memory: {},
    'token-budget': {},
    web: {},
  },

  systemPrompt: {
    withTools: WITH_TOOLS_TEMPLATE,
  },
};
