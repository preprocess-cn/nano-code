/**
 * command-readonly.ts
 *
 * Bash 命令只读检测。通过静态分析命令字符串判断是否为只读操作，
 * 用于跳过权限确认弹窗。
 *
 * 检测策略（四层过滤）：
 *   1) Shell 操作符 — > < | ; & $() 反引号 \n → 写入
 *   2) 环境变量前缀剥离（KEY=VALUE ...）
 *   3) 特殊命令：find(exec/delete)、git(子命令)、sed(-i)、awk(-i inplace)
 *   4) 安全命令白名单匹配
 */

// ── Shell 操作符（任一出现即判定为写入） ──
// 管道 | 也判定为写入：无法静态判断管道链中是否有 tee 等写入命令。
// 这是 CC 的保守策略。
const SHELL_OPERATORS = /[><|;&`\n]|\$\(/;

// ── 安全命令白名单（只读命令） ──
const SAFE_COMMANDS = new Set([
  // ── 文件查看/检查 ──
  'cat', 'head', 'tail', 'less', 'more',
  'cut', 'tr', 'fold', 'expand', 'unexpand', 'fmt', 'pr',
  'nl', 'od', 'hexdump', 'xxd',
  'strings', 'file', 'stat', 'du', 'df',

  // ── 目录浏览 ──
  'ls', 'tree',

  // ── 文本搜索 ──
  'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack', 'pt',

  // ── 文本处理（只读模式） ──
  'sort', 'wc', 'uniq', 'comm', 'diff', 'sdiff', 'cmp', 'diff3', 'colordiff',
  'iconv',
  'basename', 'dirname', 'readlink', 'realpath',

  // ── 系统信息 ──
  'dmesg', 'lsblk', 'lscpu', 'lsusb', 'lspci',
  'free', 'uptime',
  'vmstat', 'iostat', 'mpstat', 'pidstat',
  'ss', 'ps', 'pstree', 'top', 'htop', 'btop',
  'lsof', 'fuser',

  // ── 身份/环境信息 ──
  'pwd', 'whoami', 'id', 'groups', 'logname', 'users', 'pinky', 'who', 'w',
  'uname', 'hostname', 'nproc', 'getconf',
  'date', 'cal', 'ncal',
  'locale', 'env', 'printenv',
  'tty', 'which',

  // ── Shell 内建（只读形式） ──
  'type', 'hash',

  // ── 输出（无重定向时安全） ──
  'echo', 'printf',
  'yes', 'seq',

  // ── 数学/计算 ──
  'expr', 'bc', 'dc',

  // ── 压缩文件读取 ──
  'zcat', 'zless', 'zmore', 'zgrep', 'zegrep', 'zfgrep',
  'bzcat', 'bzgrep', 'xzcat', 'xzgrep', 'lz4cat',

  // ── 杂项 ──
  'history', 'help',
]);

// ── Git 全局选项（出现于子命令之前，需跳过） ──
const GIT_GLOBAL_OPTIONS = new Set([
  '-C', '-c',
  '--no-pager', '--paginate', '--bare',
  '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
  '--icase-pathspecs', '--no-optional-locks', '--no-replace-objects',
]);

// Git global options that consume the next token
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c']);

// 跳过 git 全局选项，返回剩余的 tokens
function skipGitOptions(tokens: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (GIT_GLOBAL_OPTIONS.has(token)) {
      i += GIT_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
      continue;
    }
    // 跳过 --key=value 形式（如 --git-dir=/repo）
    if (token.startsWith('--') && token.includes('=')) {
      i += 1;
      continue;
    }
    result.push(token);
    i += 1;
  }
  return result;
}

// ── 只读 git 子命令（精确匹配第一个子命令 token） ──
// 注意：branch 和 tag 有写入形态（-d, -D, -c, -m 等），不放入此集合，走 READONLY_GIT_PATTERNS 匹配
const READONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'shortlog',
  'ls-files', 'describe', 'whatchanged', 'rev-parse',
  'help', 'version',
]);

// ── 只读 git 子命令模式（匹配完整子命令串，用于 stash list / branch --list 等） ──
const READONLY_GIT_PATTERNS = [
  /^stash\s+list\b/,
  /^branch\s+(?:--list\b|-l\b|--show-current\b|--merged\b|--no-merged\b|--contains\b|--no-contains\b|--sort\b|--format\b|--color\b|--verbose\b|-a\b|-r\b|-v\b)/,
  /^tag\s+(?:--list\b|-l\b|-n\b|--sort\b|--format\b|--color\b|--merged\b|--no-merged\b|--contains\b|--no-contains\b)/,
  /^remote\s+(-v\b|--verbose\b)/,
  /^remote\s*$/,
  /^config\b(?:\s+--\w+)*\s+--list\b/,
  /^rev-list\s+--count\b/,
];

// ── 只读 find 子命令禁止的标志 ──
// 注：\b 在连字符前不匹配（连字符不是 \w 字符），所以用 (?:^|\s) 替代
const FIND_DENY_FLAGS = /(?:^|\s)-(?:exec|execdir|delete|ok)\b/;

/**
 * 判断一个 bash 命令是否为只读（无副作用的查询操作）。
 *
 * - true  = 只读命令，可以跳过权限确认
 * - false = 可能写入的命令，需要权限确认
 *
 * @param command 原始 bash 命令字符串
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Layer 1: Shell 操作符检测
  if (SHELL_OPERATORS.test(trimmed)) {
    return false;
  }

  // Layer 2: 剥离环境变量前缀 (KEY=VALUE ...)
  let cmd = trimmed;
  const envPrefix = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/;
  cmd = cmd.replace(envPrefix, '');

  // 提取第一个 token
  const tokens = cmd.split(/\s+/);
  if (tokens.length === 0) return false;

  let baseCommand = tokens[0];

  // 剥离路径前缀 (/usr/bin/cat → cat)
  baseCommand = baseCommand.split('/').pop() || baseCommand;

  // 剥离反斜杠别名绕过前缀 (\ls → ls)
  if (baseCommand.startsWith('\\')) {
    baseCommand = baseCommand.slice(1);
  }

  // 处理 "time" 前缀 — 递归检查剩余部分
  if (baseCommand === 'time') {
    return isReadOnlyCommand(tokens.slice(1).join(' '));
  }

  // 处理 "command" 前缀 — 跳过 [-vV] 标志后检查实际命令
  if (baseCommand === 'command') {
    const rest = tokens.slice(1).filter(t => t !== '-v' && t !== '-V');
    if (rest.length === 0) return false;
    return isReadOnlyCommand(rest.join(' '));
  }

  // Layer 3: 特殊命令处理
  // ── find ──
  if (baseCommand === 'find') {
    const args = tokens.slice(1).join(' ');
    return !FIND_DENY_FLAGS.test(args);
  }

  // ── git ──
  if (baseCommand === 'git') {
    const gitTokens = tokens.slice(1);
    // 跳过全局选项（如 -c key=val、--no-pager 等），找到真正的子命令
    const filtered = skipGitOptions(gitTokens);
    const subcommand = filtered.join(' ');
    if (!subcommand) return false;
    const subTokens = filtered;
    const firstSub = subTokens[0];
    // --version / --help 等以 -- 开头的内置只读命令
    if (firstSub.startsWith('--')) {
      const stripped = firstSub.slice(2);
      if (READONLY_GIT_SUBCOMMANDS.has(stripped)) return true;
    }
    if (READONLY_GIT_SUBCOMMANDS.has(firstSub)) return true;
    for (const pattern of READONLY_GIT_PATTERNS) {
      if (pattern.test(subcommand)) return true;
    }
    // git branch 和 git tag 裸用（无参数）— 列表模式
    if (firstSub === 'branch' || firstSub === 'tag') {
      return subTokens.length === 1;
    }
    return false;
  }

  // ── sed （-i = in-place 编辑，后缀可紧贴如 -ibak；不用 \b 因为 i 和 bak 同为 \w） ──
  if (baseCommand === 'sed') {
    const args = tokens.slice(1).join(' ');
    return !/(?:^|\s)-i/.test(args);
  }

  // ── awk （-i inplace = in-place 编辑） ──
  if (baseCommand === 'awk') {
    const args = tokens.slice(1).join(' ');
    return !/(?:^|\s)-i\s+inplace\b/.test(args);
  }

  // Layer 4: 安全命令白名单
  return SAFE_COMMANDS.has(baseCommand);
}
