import { test, describe } from 'node:test';
import assert from 'node:assert';
import { interpretCommandResult } from '../src/plugins/tools/command-semantics.js';

describe('interpretCommandResult', () => {

  // ── exit 0 ──

  test('exit 0 对任何命令都不是错误', () => {
    for (const cmd of ['grep foo', 'diff a b', 'find .', 'test -f file', 'cat file', 'rm file']) {
      assert.strictEqual(interpretCommandResult(cmd, 0).isError, false);
    }
  });

  // ── 默认语义：非零退出码 = 错误 ──

  test('默认语义：非零退出码是错误', () => {
    assert.strictEqual(interpretCommandResult('cat /nonexistent', 1).isError, true);
    assert.strictEqual(interpretCommandResult('rm file', 1).isError, true);
    assert.strictEqual(interpretCommandResult('mkdir dir', 1).isError, true);
    assert.strictEqual(interpretCommandResult('ls /nonexistent', 2).isError, true);
    assert.strictEqual(interpretCommandResult('node -e "process.exit(1)"', 1).isError, true);
    assert.strictEqual(interpretCommandResult('cd /nonexistent', 1).isError, true);
    assert.strictEqual(interpretCommandResult('cp a b', 1).isError, true);
  });

  // ── grep 系：exit 1 = 未匹配，exit >= 2 = 错误 ──

  describe('grep 系', () => {
    const grepVariants = ['grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ag', 'ack', 'pt',
      'zgrep', 'zegrep', 'zfgrep', 'bzgrep', 'xzgrep'];

    for (const cmd of grepVariants) {
      test(`"${cmd}" exit=1 不是错误`, () => {
        const result = interpretCommandResult(`${cmd} pattern file`, 1);
        assert.strictEqual(result.isError, false);
        assert.strictEqual(result.message, 'No matches found.');
      });

      test(`"${cmd}" exit=2 是错误`, () => {
        assert.strictEqual(interpretCommandResult(`${cmd} pattern file`, 2).isError, true);
      });
    }

    test('grep exit=1 返回语义消息', () => {
      const result = interpretCommandResult('grep foo bar.txt', 1);
      assert.strictEqual(result.message, 'No matches found.');
    });
  });

  // ── diff 系：exit 1 = 文件有差异，exit >= 2 = 错误 ──

  describe('diff 系', () => {
    const diffVariants = ['diff', 'sdiff', 'colordiff', 'diff3', 'cmp'];

    for (const cmd of diffVariants) {
      test(`"${cmd}" exit=1 不是错误`, () => {
        const result = interpretCommandResult(`${cmd} a b`, 1);
        assert.strictEqual(result.isError, false);
        assert.strictEqual(result.message, 'Files differ.');
      });

      test(`"${cmd}" exit=2 是错误`, () => {
        assert.strictEqual(interpretCommandResult(`${cmd} a b`, 2).isError, true);
      });
    }
  });

  // ── find：exit 1 = 部分不可访问 ──

  describe('find', () => {
    test('find exit=1 不是错误', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 1);
      assert.strictEqual(result.isError, false);
      assert.strictEqual(result.message, 'Some directories or files were not accessible.');
    });

    test('find exit=2 是错误', () => {
      assert.strictEqual(interpretCommandResult('find . -name "*.ts"', 2).isError, true);
    });
  });

  // ── test 系：exit 1 = 条件为假 ──

  describe('test 系', () => {
    for (const cmd of ['test', '[']) {
      test(`"${cmd}" exit=1 不是错误`, () => {
        const result = interpretCommandResult(`${cmd} -f file`, 1);
        assert.strictEqual(result.isError, false);
        assert.strictEqual(result.message, 'Condition evaluated to false.');
      });

      test(`"${cmd}" exit=2 是错误`, () => {
        assert.strictEqual(interpretCommandResult(`${cmd} -f file`, 2).isError, true);
      });
    }
  });

  // ── 命令前缀剥离 ──

  describe('base command 提取', () => {
    test('路径前缀被剥离', () => {
      assert.strictEqual(interpretCommandResult('/usr/bin/grep foo', 1).isError, false);
    });

    test('环境变量前缀被剥离', () => {
      assert.strictEqual(interpretCommandResult('LC_ALL=C grep foo', 1).isError, false);
    });

    test('time 前缀被剥离', () => {
      assert.strictEqual(interpretCommandResult('time grep foo', 1).isError, false);
    });

    test('command 前缀被剥离', () => {
      assert.strictEqual(interpretCommandResult('command grep foo', 1).isError, false);
    });
  });
});
