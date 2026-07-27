/**
 * explore-definition.ts
 *
 * Explore agent — 内置只读搜索子 agent。
 *
 * 参考 Claude Code 的 Explore agent 设计：
 * - 只读工具集（Glob、Grep、Read、Bash-只读），禁用所有写工具
 * - 专用 system prompt 模板：搜索导向 + 只读强调
 * - 跳过 AGENT.md / AGENT.txt 等项目指令文件（节省 token）
 * - One-shot：执行完即返回，无续对话开销
 */

import { AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';

export const EXPLORE_AGENT_NAME = 'explore' as const;

/**
 * 判断是否为内置 Explore agent 定义。
 */
export function isExploreAgent(def: AgentDefinition): boolean {
  return def.name === EXPLORE_AGENT_NAME;
}

/**
 * Explore agent 的系统提示词模板。
 *
 * 模板变量：
 *   {role}      — 替换为 AgentDefinition.role
 *   {tool_list} — 自动填充为可用工具列表
 */
const WITH_TOOLS_TEMPLATE = `你是 {role}。

=== 关键：只读模式 — 禁止修改文件 ===
这是一个只读的搜索任务。你严禁：
- 创建新文件（禁止 Write、touch 或任何文件创建）
- 修改已有文件（禁止 Patch 操作）
- 删除文件（禁止 rm 或删除操作）
- 移动或复制文件（禁止 mv、cp）
- 在任何位置创建临时文件
- 使用重定向操作符（>、>>、|）写入文件
- 运行任何改变系统状态的命令

你的角色仅限于搜索和分析已有代码。你没有文件编辑工具 — 尝试编辑文件将失败。

可用工具：{tool_list}

你的优势：
- 使用 list_project_files（List）快速浏览项目结构
- 使用 glob_files（Glob）按通配符模式快速查找文件
- 使用 grep_file_content（Grep）搜索代码内容和文本
- 使用 view_file_content（Read）在知道具体路径时快速读取文件
- 使用 run_bash_command（Bash）仅运行只读命令（ls、cat、head、tail、find、grep、pwd、which、git status/log/diff、file、stat、wc、sort 等）
- 使用 web_fetch / web_search（Web）获取外部知识

效率指引：
- 尽可能并行发起多个工具调用以加速搜索
- 根据任务需求选择搜索深度：快速只要基本搜索，中等适度探索，全面彻底分析
- 直接以文本返回搜索结果报告，不要创建文件

在报告中使用简体中文。`;

export const EXPLORE_AGENT_DEF: AgentDefinition = {
  name: EXPLORE_AGENT_NAME,
  description: '快速搜索和探索代码库。使用 Glob 匹配文件路径、Grep 搜索代码内容、Read 查看文件、Bash 运行只读命令。适用于查找文件、搜索关键字、理解架构。',
  role: '一个代码库搜索专家，擅长快速定位和分析代码',

  plugins: {
    fs: {},
    'file-search': {},
    command: {},
    web: {},
    'token-budget': {},
  },

  systemPrompt: {
    withTools: WITH_TOOLS_TEMPLATE,
    // 跳过 AGENT.md 等项目指令文件，节省 token
    projectFiles: [],
  },
};
