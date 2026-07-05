import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findBuiltinCommand } from '../src/plugins/commands/builtin.js';

/**
 * Helper: create a temporary directory with a minimal git repository.
 * Returns the path and a cleanup function.
 */
function setupGitRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-git-test-'));
  execSync('git init', { cwd: dir, encoding: 'utf-8' });
  execSync('git config user.email test@test.com', { cwd: dir, encoding: 'utf-8' });
  execSync('git config user.name Test', { cwd: dir, encoding: 'utf-8' });
  return {
    dir,
    cleanup: () => { try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ } },
  };
}

/**
 * Helper: create a file in the git repo.
 */
function createFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return name;
}

/**
 * Helper: run handler with a mock context that only provides args and cwd.
 * We override process.cwd() temporarily to point to the test repo.
 */
function runHandler(
  commandName: string,
  args: string,
  cwd: string,
): Promise<{ handled: boolean; skipAgent?: boolean; message: string }> {
  const cmd = findBuiltinCommand(commandName);
  if (!cmd) throw new Error(`Command "${commandName}" not found`);

  const origCwd = process.cwd;
  process.cwd = () => cwd;
  try {
    return cmd.handler({ args } as any) as Promise<any>;
  } finally {
    process.cwd = origCwd;
  }
}

describe('/diff command', () => {

  it('shows clean message when no changes', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'README.md', '# Test');
      execSync('git add README.md && git commit -m init', { cwd: dir, encoding: 'utf-8' });

      const result = await runHandler('diff', '', dir);
      assert.equal(result.handled, true);
      assert.equal(result.skipAgent, true);
      assert.ok(result.message.includes('工作区干净'));
    } finally {
      cleanup();
    }
  });

  it('shows diff for unstaged changes', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'file.txt', 'original');
      execSync('git add file.txt && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'file.txt', 'modified');

      const result = await runHandler('diff', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('-original'));
      assert.ok(result.message.includes('+modified'));
    } finally {
      cleanup();
    }
  });

  it('shows staged diff with --staged flag', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'a.txt', 'v1');
      execSync('git add a.txt && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'a.txt', 'v2');
      execSync('git add a.txt', { cwd: dir, encoding: 'utf-8' });

      const result = await runHandler('diff', '--staged', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('-v1'));
      assert.ok(result.message.includes('+v2'));
    } finally {
      cleanup();
    }
  });

  it('passes arbitrary git diff arguments through', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'f1.txt', 'a');
      createFile(dir, 'f2.txt', 'b');
      execSync('git add . && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'f1.txt', 'a1');
      createFile(dir, 'f2.txt', 'b1');

      const result = await runHandler('diff', '--stat', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('f1.txt'));
      assert.ok(result.message.includes('f2.txt'));
    } finally {
      cleanup();
    }
  });

  it('errors when not in a git repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-no-git-'));
    try {
      const result = await runHandler('diff', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('执行失败'));
    } finally {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
  });

});

describe('/status command', () => {

  it('shows status in a clean repo', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'README.md', '# Test');
      execSync('git add README.md && git commit -m init', { cwd: dir, encoding: 'utf-8' });

      const result = await runHandler('status', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('工作区干净'));
    } finally {
      cleanup();
    }
  });

  it('shows modified file in status', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'main.ts', '// original');
      execSync('git add main.ts && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'main.ts', '// changed');

      const result = await runHandler('status', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('main.ts'));
    } finally {
      cleanup();
    }
  });

  it('shows untracked files', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'existing.txt', 'existing');
      execSync('git add existing.txt && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'newfile.ts', '// new');

      const result = await runHandler('status', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('newfile.ts'));
    } finally {
      cleanup();
    }
  });

  it('supports --long flag for verbose output', async () => {
    const { dir, cleanup } = setupGitRepo();
    try {
      createFile(dir, 'app.ts', 'initial');
      execSync('git add app.ts && git commit -m init', { cwd: dir, encoding: 'utf-8' });
      createFile(dir, 'app.ts', 'modified content');

      const result = await runHandler('status', '--long', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('app.ts'));
    } finally {
      cleanup();
    }
  });

  it('errors when not in a git repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-no-git-'));
    try {
      const result = await runHandler('status', '', dir);
      assert.equal(result.handled, true);
      assert.ok(result.message.includes('执行失败'));
    } finally {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
  });

});
