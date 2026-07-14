import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isReadOnlyCommand } from '../src/plugins/tools/command-readonly.js';

describe('isReadOnlyCommand', () => {

  // ── 安全命令 ──

  describe('safe commands', () => {
    const safes = [
      // 文件查看
      'cat foo.txt', 'head -20 file', 'tail -f log', 'less file', 'more file',
      'cut -d, -f1 file', 'tr a-z A-Z', 'strings bin', 'file test.bin',
      'stat file', 'du -sh .', 'df -h',
      // 目录浏览
      'ls -la', 'tree src/',
      // 文本搜索
      'grep -r foo .', 'egrep "pattern" file', 'fgrep "literal" file',
      'rg "pattern" src/', 'ripgrep "pattern"',
      // 文本处理
      'sort file', 'wc -l file', 'uniq file', 'diff a b', 'cmp a b',
      'basename /path/to/file', 'dirname /path/to/file', 'readlink -f file',
      'realpath file',
      // 系统信息
      'free -h', 'uptime', 'dmesg', 'lsblk', 'lscpu', 'lspci',
      'ps aux', 'pstree', 'top -n 1', 'ss -tuln', 'lsof -i :8080',
      // 身份信息
      'pwd', 'whoami', 'id', 'groups', 'uname -a', 'hostname',
      'nproc', 'getconf LONG_BIT', 'date +%s', 'cal', 'locale',
      'env', 'printenv PATH', 'tty', 'which node',
      // Shell 内建
      'type ls', 'hash',
      'echo hello', 'printf "%s" hello', 'yes hello', 'seq 1 10',
      // 数学
      'expr 1 + 2', 'bc -l', 'dc -e "1 2 + p"',
      // 压缩读取
      'zcat file.gz', 'zless file.gz', 'zgrep pattern file.gz',
      'bzcat file.bz2', 'xzcat file.xz',
      // 杂项
      'history', 'help',
      // 路径限定
      '/usr/bin/cat file', '/bin/ls -la',
      // 前缀剥离
      '\\ls -la', 'time ls -la', 'command -v cat',
      // 环境变量前缀
      'LC_ALL=C grep foo file',
      'CC=gcc CXX=g++ grep foo',
    ];

    for (const cmd of safes) {
      test(`"${cmd}" → true`, () => {
        assert.strictEqual(isReadOnlyCommand(cmd), true);
      });
    }
  });

  // ── 写入命令 ──

  describe('write commands', () => {
    const writes = [
      // Shell 操作符
      'cat foo > bar', 'cat foo >> bar', 'ls | head', 'echo ok ; rm file',
      'echo ok && rm file', 'rm file || echo ok',
      'echo $(ls)', 'echo `ls`', 'cat file &',
      // 文件操作（不在安全列表）
      'rm file', 'mv a b', 'cp a b', 'mkdir dir', 'touch file',
      'chmod +x file', 'chown user file', 'ln -s a b',
      // 包管理
      'npm install', 'npm run build', 'pnpm add foo', 'yarn add foo',
      'bun install', 'pip install foo', 'cargo build',
      // 编辑器
      'vim file', 'nano file', 'code file',
      // 编译/脚本
      'python3 script.py', 'node index.js', 'tsc', 'gcc -o out main.c',
      'make', 'make install',
      // 网络（可能造成副作用）
      'curl http://example.com', 'wget http://example.com',
      'ssh user@host', 'rsync -av src/ dst/', 'scp a b:',
      // 特殊命令（非安全）
      'dd if=/dev/zero of=file bs=1M count=1',
      // 空命令
      '', '   ',
    ];

    for (const cmd of writes) {
      test(`"${cmd}" → false`, () => {
        assert.strictEqual(isReadOnlyCommand(cmd), false);
      });
    }
  });

  // ── find 特殊处理 ──

  describe('find command', () => {
    test('find without destructive flags → true', () => {
      assert.strictEqual(isReadOnlyCommand('find . -name "*.ts"'), true);
    });

    test('find with -name and -type → true', () => {
      assert.strictEqual(isReadOnlyCommand('find src -type f -name "*.ts"'), true);
    });

    test('find with -exec → false', () => {
      assert.strictEqual(isReadOnlyCommand('find . -exec rm {} \\;'), false);
    });

    test('find with -execdir → false', () => {
      assert.strictEqual(isReadOnlyCommand('find . -execdir rm {} \\;'), false);
    });

    test('find with -delete → false', () => {
      assert.strictEqual(isReadOnlyCommand('find . -name "*.tmp" -delete'), false);
    });

    test('find with -ok → false', () => {
      assert.strictEqual(isReadOnlyCommand('find . -ok rm {} \\;'), false);
    });

    test('find with -size → true', () => {
      assert.strictEqual(isReadOnlyCommand('find /var/log -size +100M'), true);
    });
  });

  // ── git 特殊处理 ──

  describe('git command', () => {
    const readOnlyGits = [
      'git status', 'git log', 'git log --oneline -5', 'git diff',
      'git diff --cached', 'git show HEAD', 'git blame file.ts',
      'git shortlog', 'git stash list', 'git ls-files',
      'git describe --tags', 'git rev-parse HEAD',
      'git branch --list', 'git branch -l', 'git tag --list',
      'git remote -v', 'git config --list', 'git rev-list --count HEAD',
      'git whatchanged', 'git help', 'git --version',
    ];
    for (const cmd of readOnlyGits) {
      test(`"${cmd}" → true`, () => {
        assert.strictEqual(isReadOnlyCommand(cmd), true);
      });
    }

    const writeGits = [
      'git push', 'git push origin main', 'git commit -m "fix"',
      'git add .', 'git add file.ts', 'git rm file.ts',
      'git checkout feature', 'git switch feature', 'git restore file.ts',
      'git merge feature', 'git rebase main', 'git revert HEAD',
      'git reset HEAD~1', 'git branch -d old', 'git tag -d v1',
      'git stash push', 'git stash drop', 'git cherry-pick abc123',
      'git gc', 'git prune', 'git clean -fd', 'git submodule update',
      'git worktree add /tmp/test', 'git worktree prune',
    ];
    for (const cmd of writeGits) {
      test(`"${cmd}" → false`, () => {
        assert.strictEqual(isReadOnlyCommand(cmd), false);
      });
    }
  });

  // ── sed 特殊处理 ──

  describe('sed command', () => {
    test('sed without -i → true', () => {
      assert.strictEqual(isReadOnlyCommand("sed 's/foo/bar/g' file"), true);
    });

    test('sed with -i → false', () => {
      assert.strictEqual(isReadOnlyCommand("sed -i 's/foo/bar/g' file"), false);
    });

    test('sed with -i and empty backup suffix', () => {
      assert.strictEqual(isReadOnlyCommand("sed -i '' 's/foo/bar/g' file"), false);
    });
  });

  // ── awk 特殊处理 ──

  describe('awk command', () => {
    test('awk without -i inplace → true', () => {
      assert.strictEqual(isReadOnlyCommand("awk '{print $1}' file"), true);
    });

    test('awk with -i inplace → false', () => {
      assert.strictEqual(isReadOnlyCommand("awk -i inplace '{print $1}' file"), false);
    });
  });

  // ── 边缘情况 ──

  describe('edge cases', () => {
    test('empty string → false', () => {
      assert.strictEqual(isReadOnlyCommand(''), false);
    });

    test('whitespace only → false', () => {
      assert.strictEqual(isReadOnlyCommand('   '), false);
    });

    test('echo with redirect → false (operator priority)', () => {
      assert.strictEqual(isReadOnlyCommand('echo hello > file'), false);
    });

    test('multiple env vars stripped', () => {
      assert.strictEqual(isReadOnlyCommand('LC_ALL=C LANG=en_US.UTF-8 grep foo'), true);
    });

    test('complex env var with quotes', () => {
      assert.strictEqual(isReadOnlyCommand("CC='gcc' CFLAGS='-O2' grep foo"), true);
    });
  });
});
