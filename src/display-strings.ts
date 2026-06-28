/**
 * 框架核心展示词 — 用户可见、无需发送给大模型的提示/状态/错误等语句。
 *
 * 每个插件/工具管理自己的展示词，不在此文件中。
 * 可配置项（如 agent.greeting）保留在 config.ts 的 AgentConfig 中。
 */

// ── 退出 ──
export const EXIT_MESSAGE = '** 感谢使用 nano-code，祝您编码愉快！';

// ── 致命错误 ──
export const FATAL_NO_DISPLAY = '[FATAL] 展示层已被禁用且未指定替代插件。展示层必须存在。';
export const FATAL_NO_DISPLAY_HINT = '        请在配置中设置 display.plugin 或移除 display.enabled=false。';

// ── 模式提示 ──
export const MSG_DEBUG_MODE = (model: string | undefined) =>
  `#  当前已开启 [DEBUG 调试模式]，模型: ${model}`;

export const MSG_THINK_MODE = ' <-> 当前已开启 [思考过程显示]，将输出 AI 思考过程。';

export const MSG_SKIP_PERMISSION = ' [!] 当前已开启 [免确认模式]，系统底层安全拦截仍然生效。';

// ── 会话恢复 ──
export const MSG_SESSION_RESTORED = (count: number, updatedAt: string) =>
  `   ↻ 已恢复上次会话 (${count} 条消息，最后更新 ${updatedAt})\n`;

export const MSG_SESSION_NOT_FOUND = '   - 未找到之前保存的会话，开始新的对话。\n';

/**
 * 将 Agent 发出的状态码映射为默认展示文本。
 * Display 插件可调用此函数，也可对特定状态码自行定制。
 *
 * 约定状态码前缀：
 * - 'thinking' — Agent 正在请求 LLM
 * - 'end' — Agent 本轮处理结束
 * - 'tool_blocked:<name>' — 工具调用被拦截
 * - 其他值透传（用于来自 index.ts 等模块的原始展示字符串）
 */
export function formatStatusText(code: string): string {
  if (code === 'thinking') return '? 正在思考并请求大模型...';
  if (code === 'end') return '';
  if (code.startsWith('tool_blocked:')) {
    return `[!] [拦截] 插件拒绝了工具调用: [ ${code.slice(13)} ]`;
  }
  return code;
}

// ── LLM API ──
export const MSG_API_RETRY = (attempt: number, maxRetries: number, delaySec: number) =>
  `\n! API 请求失败（尝试 ${attempt + 1}/${maxRetries + 1}），${delaySec}秒后重试...`;

export const MSG_API_ERROR = '\nX 调用 AI API 时发生错误，请检查网络连接和 API Key 是否正确。';

export const MSG_LLM_INIT_ERROR = 'X 错误: 无法初始化 AI 客户端。请检查 API Key 和 API 地址配置。';

// ── 顶层循环 ──
export const MSG_TOP_LEVEL_ERROR = (error: unknown) =>
  `nano-code 遇到意外错误：${error instanceof Error ? error.message : String(error)}。可运行 /doctor 诊断。`;

// ── 默认欢迎语 ──
export const GREETING_WITH_TOOLS = '我可以帮您查看项目结构、读取代码并直接修改。';

export const GREETING_NO_TOOLS = '我可以帮您解答编程问题，提供代码示例和建议。';
