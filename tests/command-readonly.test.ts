import { test, describe } from 'vitest';
import assert from 'node:assert';
import { isReadOnlyCommand } from '../src/plugins/tools/command-readonly.js';

// ============================================================
// 全量命令只读检测测试
// 覆盖 SAFE_COMMANDS 白名单中每个命令 + 所有特殊命令变体
// ============================================================

// ── 安全命令白名单（SFATE_COMMANDS 中的每个命令至少一个正向用例） ──

describe('SAFE_COMMANDS — 文件查看/检查', () => {
  const cases = [
    'cat foo.txt',
    'head -20 file',
    'tail -f log',
    'less file',
    'more file',
    'cut -d, -f1 file',
    'tr a-z A-Z',
    'fold -w 80 file',
    'expand file',
    'unexpand file',
    'fmt -w 60 file',
    'pr -l 60 file',
    'nl file',
    'od -c file',
    'hexdump file',
    'xxd file',
    'strings bin',
    'file test.bin',
    'stat file',
    'du -sh .',
    'df -h',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 目录浏览', () => {
  const cases = ['ls -la', 'tree src/'];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 文本搜索', () => {
  const cases = [
    'grep -r foo .',
    'egrep "pattern" file',
    'fgrep "literal" file',
    'rg "pattern" src/',
    'ripgrep "pattern"',
    'ag "pattern"',
    'ack "pattern"',
    'pt "pattern"',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 文本处理', () => {
  const cases = [
    'sort file',
    'wc -l file',
    'uniq file',
    'comm a b',
    'diff a b',
    'sdiff a b',
    'cmp a b',
    'diff3 a b c',
    'colordiff a b',
    'iconv -f UTF-8 -t ASCII file',
    'basename /path/to/file',
    'dirname /path/to/file',
    'readlink -f file',
    'realpath file',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 系统信息', () => {
  const cases = [
    'free -h', 'uptime', 'dmesg', 'lsblk', 'lscpu', 'lsusb', 'lspci',
    'ps aux', 'pstree', 'top -n 1', 'htop', 'btop',
    'ss -tuln', 'lsof -i :8080', 'fuser 8080/tcp',
    'vmstat 1 5', 'iostat -x', 'mpstat -P ALL', 'pidstat -u',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 身份/环境信息', () => {
  const cases = [
    'pwd', 'whoami', 'id', 'groups', 'logname',
    'users', 'pinky', 'who', 'w',
    'uname -a', 'hostname', 'nproc', 'getconf LONG_BIT',
    'date +%s', 'cal', 'ncal',
    'locale', 'env', 'printenv PATH',
    'tty', 'which node',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — Shell 内建（只读形式）', () => {
  const cases = ['type ls', 'hash'];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 输出/序列', () => {
  const cases = ['echo hello', 'printf "%s" hello', 'yes hello', 'seq 1 10'];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 数学/计算', () => {
  const cases = ['expr 1 + 2', 'bc -l', 'dc -e "1 2 + p"'];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 压缩文件读取', () => {
  const cases = [
    'zcat file.gz', 'zless file.gz', 'zmore file.gz',
    'zgrep pattern file.gz', 'zegrep pattern file.gz', 'zfgrep pattern file.gz',
    'bzcat file.bz2', 'bzgrep pattern file.bz2',
    'xzcat file.xz', 'xzgrep pattern file.xz',
    'lz4cat file.lz4',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('SAFE_COMMANDS — 杂项', () => {
  const cases = ['history', 'help'];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

// ── 命令前缀剥离 ──

describe('命令前缀剥离', () => {
  test('路径前缀 /usr/bin/cat → true', () => {
    assert.strictEqual(isReadOnlyCommand('/usr/bin/cat file'), true);
  });

  test('路径前缀 /bin/ls → true', () => {
    assert.strictEqual(isReadOnlyCommand('/bin/ls -la'), true);
  });

  test('反斜杠别名绕过 \\ls → true', () => {
    assert.strictEqual(isReadOnlyCommand('\\ls -la'), true);
  });

  test('time 前缀 → 递归 true', () => {
    assert.strictEqual(isReadOnlyCommand('time ls -la'), true);
  });

  test('time 前缀 + 写入 → 递归 false', () => {
    assert.strictEqual(isReadOnlyCommand('time rm file'), false);
  });

  test('command -v 前缀 → true', () => {
    assert.strictEqual(isReadOnlyCommand('command -v cat'), true);
  });

  test('command -V 前缀 → true', () => {
    assert.strictEqual(isReadOnlyCommand('command -V cat'), true);
  });

  test('command 无参数 → false', () => {
    assert.strictEqual(isReadOnlyCommand('command'), false);
  });

  test('单环境变量前缀 LC_ALL=C grep foo → true', () => {
    assert.strictEqual(isReadOnlyCommand('LC_ALL=C grep foo'), true);
  });

  test('多环境变量前缀 CC=gcc CXX=g++ grep foo → true', () => {
    assert.strictEqual(isReadOnlyCommand('CC=gcc CXX=g++ grep foo'), true);
  });

  test('复杂 env 引号 CC=gcc CFLAGS="-O2" grep foo → true', () => {
    assert.strictEqual(isReadOnlyCommand('CC=gcc CFLAGS="-O2" grep foo'), true);
  });

  test('复杂 env 单引号 LC_ALL="en_US.UTF-8" LANG=C grep foo → true', () => {
    assert.strictEqual(isReadOnlyCommand('LC_ALL="en_US.UTF-8" LANG=C grep foo'), true);
  });
});

// ── Shell 操作符 ──

describe('Shell 操作符 — 各个操作符检测', () => {
  // 每个操作符单独测试
  test('重定向 > → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo hello > file'), false);
  });

  test('追加重定向 >> → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo hello >> file'), false);
  });

  test('重定向 < → false', () => {
    assert.strictEqual(isReadOnlyCommand('cat < /dev/zero'), false);
  });

  test('管道 | → false', () => {
    assert.strictEqual(isReadOnlyCommand('cat file | head'), false);
  });

  test('分号 ; → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo ok ; rm file'), false);
  });

  test('逻辑与 && → false', () => {
    assert.strictEqual(isReadOnlyCommand('ls && rm file'), false);
  });

  test('逻辑或 || → false', () => {
    assert.strictEqual(isReadOnlyCommand('rm file || echo ok'), false);
  });

  test('后台 & → false', () => {
    assert.strictEqual(isReadOnlyCommand('sleep 10 &'), false);
  });

  test('命令替换 $() → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo $(ls)'), false);
  });

  test('反引号 `` → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo `ls`'), false);
  });

  test('多行 \\n → false', () => {
    assert.strictEqual(isReadOnlyCommand('echo hello\nrm file'), false);
  });

  test('环境变量 + 管道 → false（操作符优先于 env 剥离）', () => {
    assert.strictEqual(isReadOnlyCommand('LC_ALL=C grep foo file | head'), false);
  });
});

// ── find 特殊处理 ──

describe('find 命令 — 安全变体', () => {
  const cases = [
    'find . -name "*.ts"',
    'find src -type f -name "*.ts"',
    'find /var/log -size +100M',
    'find . -mtime -7',
    'find . -user root -group root',
    'find . -perm 644',
    'find . -maxdepth 3 -name "*.js"',
    'find . -name "*.log" -o -name "*.tmp"',
    'find . -not -name "*.ts"',
    'find . -type d -empty',
    'find . -newer reference.txt',
    'find . -anewer reference.txt',
    'find . -cmin -60',
    'find . -size 0 -type f',
    'find . -printf "%p\\n"',
    'find . -fprintf /dev/stdout "%p\\n"',
    'find . -fls /dev/stdout',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('find 命令 — 写入变体', () => {
  const cases = [
    'find . -exec rm {} \\;',
    'find . -execdir rm {} \\;',
    'find . -name "*.tmp" -delete',
    'find . -ok rm {} \\;',
    'find . -type f -exec chmod 644 {} \\;',
    'find . -exec rm {} +',
    'find . -name "*.o" -delete',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

// ── git 特殊处理 ──
// 包含 bug 回归测试：git 全局选项、git branch/tag 裸用

describe('git 命令 — 只读子命令', () => {
  const cases = [
    'git status',
    'git status --short',
    'git log',
    'git log --oneline -5',
    'git log --all --oneline --graph',
    'git diff',
    'git diff --cached',
    'git diff HEAD~1 HEAD',
    'git diff --name-only',
    'git show HEAD',
    'git show --name-only',
    'git blame file.ts',
    'git shortlog',
    'git shortlog -sn',
    'git stash list',
    'git stash list --format="%gd"',
    'git ls-files',
    'git describe --tags',
    'git describe',
    'git rev-parse HEAD',
    'git whatchanged',
    'git help',
    'git --version',
    'git help add',
    // git rev-list with --count
    'git rev-list --count HEAD',
    'git rev-list --count HEAD..origin/main',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('git 命令 — 列表模式 (branch/tag)', () => {
  const cases = [
    // 裸用（列表模式）— bug 修复
    'git branch',
    'git tag',
    // 带列表参数
    'git branch --list',
    'git branch -l',
    'git branch -a',
    'git branch -r',
    'git branch -v',
    'git branch --show-current',
    'git branch --merged main',
    'git branch --no-merged feature',
    'git branch --contains abc123',
    'git branch --sort=-committerdate',
    'git branch --format="%(refname)"',
    'git tag --list',
    'git tag -l',
    'git tag -n',
    'git tag --sort=-version:refname',
    'git tag --merged main',
    'git tag --contains abc123',
    // remote/config
    'git remote',
    'git remote -v',
    'git config --list',
    'git config --global --list',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('git 命令 — 全局选项跳过 (bug 回归)', () => {
  const cases = [
    'git -c user.name=X log',
    'git -c core.pager=cat diff',
    'git -C /repo status',
    'git --no-pager log',
    'git --no-pager diff --cached',
    'git --paginate log',
    'git --bare status',
    'git --git-dir=/repo.git log',
    'git --work-tree=/app status',
    'git --no-optional-locks status',
    'git -c user.name=X -c core.pager=cat log',
    'git -C /work --no-pager log --oneline',
    'git --literal-pathspecs status',
    'git --icase-pathspecs log',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → true`, () => assert.strictEqual(isReadOnlyCommand(cmd), true));
  }
});

describe('git 命令 — 写入子命令', () => {
  const cases = [
    'git push',
    'git push origin main',
    'git commit -m "fix"',
    'git add .',
    'git add file.ts',
    'git rm file.ts',
    'git mv old new',
    'git checkout feature',
    'git switch feature',
    'git restore file.ts',
    'git merge feature',
    'git rebase main',
    'git revert HEAD',
    'git reset HEAD~1',
    'git branch -d old',
    'git branch -D old',
    'git branch -m old new',
    'git branch -c old new',
    'git tag -d v1',
    'git tag -a v1 -m "msg"',
    'git stash push',
    'git stash drop',
    'git stash pop',
    'git cherry-pick abc123',
    'git gc',
    'git prune',
    'git clean -fd',
    'git submodule update',
    'git worktree add /tmp/test',
    'git worktree prune',
    'git update-ref HEAD abc123',
    'git config user.name "foo"',
    'git remote add origin url',
    'git fetch origin',      // fetch 也可能写入
    'git pull origin main',
    // 全局选项 + 写入子命令（跳过选项后子命令为写入）
    'git -c user.name=X commit -m "msg"',
    'git -C /repo --no-pager push origin main',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

// ── sed 特殊处理 ──

describe('sed 命令', () => {
  test('sed 替换无 -i → true', () => {
    assert.strictEqual(isReadOnlyCommand("sed 's/foo/bar/g' file"), true);
  });

  test('sed -i → false', () => {
    assert.strictEqual(isReadOnlyCommand("sed -i 's/foo/bar/g' file"), false);
  });

  test('sed -i 空备份后缀 → false', () => {
    assert.strictEqual(isReadOnlyCommand("sed -i '' 's/foo/bar/g' file"), false);
  });

  test('sed -i 备份后缀 → false', () => {
    assert.strictEqual(isReadOnlyCommand("sed -i.bak 's/foo/bar/g' file"), false);
  });

  test('sed -i 多个表达式 → false', () => {
    assert.strictEqual(isReadOnlyCommand("sed -i -e 's/foo/bar/' -e 's/a/b/' file"), false);
  });

  test('sed -i 直接参数 → false', () => {
    assert.strictEqual(isReadOnlyCommand("sed -ibak 's/foo/bar/' file"), false);
  });

  test('sed 多个 -e 无 -i → true', () => {
    assert.strictEqual(isReadOnlyCommand("sed -e 's/foo/bar/' -e 's/a/b/' file"), true);
  });

  test('sed -n 无 -i → true', () => {
    assert.strictEqual(isReadOnlyCommand("sed -n '/pattern/p' file"), true);
  });

  test('sed -E 扩展正則 → true', () => {
    assert.strictEqual(isReadOnlyCommand("sed -E 's/[0-9]+/N/g' file"), true);
  });
});

// ── awk 特殊处理 ──

describe('awk 命令', () => {
  test('awk 打印列 → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk '{print $1}' file"), true);
  });

  test('awk -F 分隔符 → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk -F, '{print $1}' file"), true);
  });

  test('awk -v 变量 → true', () => {
    // 注意：awk 程序段内含 > < | 等 shell 操作符会被 Layer 1 静态分析误判为写入
    // 此处使用不含 shell 操作符的表达式
    assert.strictEqual(isReadOnlyCommand("awk -v name=hello '$1 == name' file"), true);
  });

  test('awk BEGIN/END → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk 'BEGIN{sum=0}{sum+=$1}END{print sum}' file"), true);
  });

  test('awk -f 脚本文件 → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk -f script.awk file"), true);
  });

  test('awk -i inplace → false', () => {
    assert.strictEqual(isReadOnlyCommand("awk -i inplace '{print $1}' file"), false);
  });

  test('awk -i inplace 复杂参数 → false', () => {
    assert.strictEqual(isReadOnlyCommand("awk -i inplace -F, '{print $1}' file"), false);
  });

  test('awk -i mylib (非 inplace) → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk -i mylib '{print}' file"), true);
  });

  test('awk 多个 -v 和 -F → true', () => {
    assert.strictEqual(isReadOnlyCommand("awk -v a=1 -v b=2 -F: '{print $a, $b}' file"), true);
  });
});

// ── 写入命令（非安全白名单/非特殊处理） ──

describe('写入命令 — 文件/目录操作', () => {
  const cases = [
    'rm file',
    'rm -rf dir',
    'mv a b',
    'cp a b',
    'cp -r src dst',
    'mkdir dir',
    'mkdir -p a/b/c',
    'touch file',
    'chmod +x file',
    'chown user file',
    'chgrp group file',
    'ln -s a b',
    'rmdir dir',
    'install -d dir',
    'mktemp',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

describe('写入命令 — 包管理', () => {
  const cases = [
    'npm install',
    'npm run build',
    'pnpm add foo',
    'yarn add foo',
    'bun install',
    'pip install foo',
    'pip3 install foo',
    'poetry add foo',
    'cargo build',
    'cargo install',
    'go install',
    'go mod tidy',
    'gem install foo',
    'brew install foo',
    'apt install foo',
    'apt-get install foo',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

describe('写入命令 — 编辑器/编译', () => {
  const cases = [
    'vim file',
    'nano file',
    'code file',
    'python3 script.py',
    'node index.js',
    'tsc',
    'tsc --noEmit',
    'gcc -o out main.c',
    'make',
    'make install',
    'ninja',
    'cmake --build .',
    'clang -o out main.c',
    'cargo build',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

describe('写入命令 — 网络/远程', () => {
  const cases = [
    'curl http://example.com',
    'curl -X POST -d data http://example.com',
    'wget http://example.com',
    'ssh user@host',
    'rsync -av src/ dst/',
    'scp a b:',
    'sftp user@host',
    'nc host 8080',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

describe('写入命令 — 权限/挂载', () => {
  const cases = [
    'sudo ls',       // sudo 本身可写
    'su - user',
    'mount /dev/sda /mnt',
    'umount /mnt',
    'dd if=/dev/zero of=file bs=1M count=1',
    'truncate -s 1M file',
    'fallocate -l 1M file',
    'tee file <<< text',
  ];
  for (const cmd of cases) {
    test(`"${cmd}" → false`, () => assert.strictEqual(isReadOnlyCommand(cmd), false));
  }
});

// ── 边缘情况 ──

describe('边缘情况', () => {
  test('空字符串 → false', () => {
    assert.strictEqual(isReadOnlyCommand(''), false);
  });

  test('空白字符串 → false', () => {
    assert.strictEqual(isReadOnlyCommand('   '), false);
  });

  test('未知命令 → false', () => {
    assert.strictEqual(isReadOnlyCommand('some-random-command'), false);
  });

  test('安全命令 + 重定向 → false (操作符优先)', () => {
    assert.strictEqual(isReadOnlyCommand('cat file > out'), false);
  });

  test('安全命令 + 管道 → false', () => {
    assert.strictEqual(isReadOnlyCommand('grep foo file | head'), false);
  });

  test('未知命令 + 环境变量前缀 → false', () => {
    assert.strictEqual(isReadOnlyCommand('MY_VAR=1 unknown-cmd'), false);
  });

  test('命令含数字后缀 → false', () => {
    assert.strictEqual(isReadOnlyCommand('myapp123'), false);
  });

  test('命令含点号 → false', () => {
    assert.strictEqual(isReadOnlyCommand('app-v2'), false);
  });

  test('只读命令 + 分号 + 写入命令 → false', () => {
    assert.strictEqual(isReadOnlyCommand('ls; rm file'), false);
  });

  test('只读命令 + && + 写入命令 → false', () => {
    assert.strictEqual(isReadOnlyCommand('ls && rm file'), false);
  });
});
