/**
 * command-semantics.ts
 *
 * 命令退出码语义解释层。参照 Claude Code 的设计：
 * 不同命令的非零退出码有不同的语义，并非所有非零都表示"执行失败"。
 *
 * grep 退出码 1 = 未匹配到结果（正常语义，非错误）
 * diff 退出码 1 = 文件有差异（正常语义，非错误）
 * find 退出码 1 = 部分目录不可访问（正常语义，非错误）
 * test 退出码 1 = 条件为假（正常语义，非错误）
 */

export interface CommandSemantic {
  /** 是否为真正的错误 */
  isError: boolean;
  /** 退出码的语义解释（非错误时用） */
  message?: string;
}

// ── 命令集合 ──

// grep 系：exit 1 = "未匹配"
const GREP_LIKE = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack', 'pt',
  'zgrep', 'zegrep', 'zfgrep', 'bzgrep', 'xzgrep',
]);

// diff 系：exit 1 = "文件有差异"
const DIFF_LIKE = new Set([
  'diff', 'sdiff', 'colordiff', 'diff3', 'cmp',
]);

// find：exit 1 = "部分目录不可访问"
const FIND = 'find';

// test 系：exit 1 = "条件为假"
const TEST_LIKE = new Set(['test', '[']);

// ── 语义解释函数 ──

/**
 * 判断命令的退出码是否表示真正的错误。
 *
 * @param command  原始命令字符串（用于提取 base command）
 * @param exitCode 进程退出码
 */
export function interpretCommandResult(command: string, exitCode: number): CommandSemantic {
  if (exitCode === 0) return { isError: false };

  const baseCommand = extractBaseCommand(command);

  // grep 系列：exit 1 = 未匹配，exit >= 2 = 错误
  if (GREP_LIKE.has(baseCommand) && exitCode === 1) {
    return { isError: false, message: 'No matches found.' };
  }

  // diff 系列：exit 1 = 文件有差异，exit >= 2 = 错误
  if (DIFF_LIKE.has(baseCommand) && exitCode === 1) {
    return { isError: false, message: 'Files differ.' };
  }

  // find：exit 1 = 部分目录不可访问
  if (baseCommand === FIND && exitCode === 1) {
    return { isError: false, message: 'Some directories or files were not accessible.' };
  }

  // test / [：exit 1 = 条件为假
  if (TEST_LIKE.has(baseCommand) && exitCode === 1) {
    return { isError: false, message: 'Condition evaluated to false.' };
  }

  // 默认：任何非零退出码都是错误
  return { isError: true };
}

// ── 辅助：从命令字符串中提取 base command ──

function extractBaseCommand(command: string): string {
  // 剥离环境变量前缀
  let cmd = command.trim();
  const envPrefix = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/;
  cmd = cmd.replace(envPrefix, '');

  const tokens = cmd.split(/\s+/);
  if (tokens.length === 0) return '';

  let base = tokens[0];

  // 剥离路径前缀
  base = base.split('/').pop() || base;

  // 剥离反斜杠前缀
  if (base.startsWith('\\')) base = base.slice(1);

  // 处理 time/command/builtin 等前缀
  if (base === 'time' || base === 'command' || base === 'builtin') {
    return extractBaseCommand(tokens.slice(1).join(' '));
  }

  return base;
}
