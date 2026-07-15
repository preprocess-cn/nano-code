import * as path from 'path';
import * as fs from 'fs';
import { PermissionDecision, PermissionMode, PermissionRuleSource, PermissionUpdate } from './types.js';

// ── 内部路径匹配（.nano-code 基础设施文件） ──

const INTERNAL_PATH_PATTERNS = [
  /\.nano-code-session\.json$/,
  /\/\.nano-code\//,
  /\.nano-code\.(yaml|yml)$/,
  /\/\.nano-code\.debug\.(yaml|yml)$/,
  /\/\.nano-code\.ink\.(yaml|yml)$/,
];

// ── 危险写入路径（写入即拒绝） ──

const DANGEROUS_WRITE_PATTERNS = [
  /\/(etc|usr\/bin|usr\/sbin|bin|sbin|boot|dev|proc|sys)(\/|$)/,
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /\/\.git\//,
  /\/\.git$/,
];

const SENSITIVE_WRITE_PATTERNS = [
  /\/\.bashrc$/,
  /\/\.bash_profile$/,
  /\/\.bash_logout$/,
  /\/\.zshrc$/,
  /\/\.zprofile$/,
  /\/\.zshenv$/,
  /\/\.gitconfig$/,
  /\/\.gitignore$/,
  /\/\.profile$/,
  /\/\.login$/,
  /\/\.config\//,
];

// ── 路径工具 ──

/**
 * 解析路径的完整符号链接链。
 * 返回所有解析形式（原始路径 + 各层 symlink 目标 + realpath）。
 *
 * 与 CC getPathsForPermissionCheck 等价，但简化:
 * - 无 Windows/UNC 检查
 * - 深度限制 40
 * - 不处理 FIFO/socket 等特殊文件
 */
export function getPathsForPermissionCheck(inputPath: string): string[] {
  const paths: Set<string> = new Set();
  const absolutePath = path.resolve(inputPath);
  paths.add(absolutePath);

  // 获取 realpath（完整的 symlink 解析）
  try {
    const real = fs.realpathSync(absolutePath);
    if (real !== absolutePath) {
      paths.add(real);
    }
  } catch {
    // 路径不存在或有权限问题 — 尝试逐级解析
    walkSymlinkChain(absolutePath, paths, 0);
  }

  return Array.from(paths);
}

const SYMLINK_DEPTH_LIMIT = 40;

function walkSymlinkChain(p: string, paths: Set<string>, depth: number): void {
  if (depth > SYMLINK_DEPTH_LIMIT) return;

  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      const resolved = path.resolve(path.dirname(p), target);
      paths.add(resolved);
      walkSymlinkChain(resolved, paths, depth + 1);
    }
  } catch {
    // 无法 lstat，停止追溯
  }

  // 同时尝试解析存在的父目录
  try {
    const parent = path.dirname(p);
    if (parent !== p) {
      const parentReal = fs.realpathSync(parent);
      if (parentReal !== parent) {
        paths.add(path.resolve(parentReal, path.basename(p)));
      }
    }
  } catch {
    // 父目录不可达
  }
}

/**
 * 判定 targetPath 是否在 workingPath 之内。
 * 基于相对路径计算：
 *   targetPath = /a/b/c,   workingPath = /a/b → relative = "c"      → in
 *   targetPath = /a/b/c,   workingPath = /a/d → relative = "../b/c" → out
 */
function pathInWorkingPath(targetPath: string, workingPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedWorking = path.resolve(workingPath);
  const relative = path.relative(normalizedWorking, normalizedTarget);
  if (relative === '') return true;
  return !relative.startsWith('..');
}

/**
 * macOS 路径规范化: /private/var → /var, /private/tmp → /tmp
 * 这些在 macOS 上是符号链接，会导致路径判定问题。
 */
function normalizeMacOSPseudoPath(p: string): string {
  if (process.platform === 'darwin') {
    if (p.startsWith('/private/var/')) return p.replace(/^\/private\/var\//, '/var/');
    if (p === '/private/var') return '/var';
    if (p.startsWith('/private/tmp/')) return p.replace(/^\/private\/tmp\//, '/tmp/');
    if (p === '/private/tmp') return '/tmp';
  }
  return p;
}

// ── PathValidator ──

export class PathValidator {
  private originalCwd: string;
  private additionalDirs: Map<string, { source: PermissionRuleSource }> = new Map();
  private dirCache: Map<string, string[]> = new Map(); // dir → resolved forms

  constructor(cwd: string) {
    this.originalCwd = path.resolve(cwd);
  }

  // ── 工作目录管理 ──

  addDirectory(dir: string, source: PermissionRuleSource): void {
    const resolved = path.resolve(dir);
    this.additionalDirs.set(resolved, { source });
    this.dirCache.delete(resolved); // 清除缓存
  }

  removeDirectory(dir: string): void {
    const resolved = path.resolve(dir);
    this.additionalDirs.delete(resolved);
    this.dirCache.delete(resolved);
  }

  getAllWorkingDirectories(): string[] {
    const dirs = [this.originalCwd];
    for (const dir of this.additionalDirs.keys()) {
      dirs.push(dir);
    }
    return dirs;
  }

  /** 获取工作目录的所有解析形式（含符号链接链） */
  private getWorkingDirForms(dir: string): string[] {
    const cached = this.dirCache.get(dir);
    if (cached) return cached;
    const forms = getPathsForPermissionCheck(dir).map(normalizeMacOSPseudoPath);
    this.dirCache.set(dir, forms);
    return forms;
  }

  // ── 路径判定 ──

  /**
   * 核心函数: 判定路径是否在任何允许的工作目录内。
   *
   * 要求: targetPath 的所有解析形式都必须落在某个工作目录的某个解析形式中。
   * 这防止通过符号链接绕过权限检查（一个路径同时有安全和不安全的访问方式）。
   */
  pathInAllowedWorkingPath(targetPath: string): boolean {
    const targetForms = getPathsForPermissionCheck(targetPath).map(normalizeMacOSPseudoPath);
    if (targetForms.length === 0) return false;

    const allWorkingDirs = this.getAllWorkingDirectories();

    for (const targetForm of targetForms) {
      let found = false;
      for (const wd of allWorkingDirs) {
        const wdForms = this.getWorkingDirForms(wd);
        for (const wdForm of wdForms) {
          if (pathInWorkingPath(targetForm, wdForm)) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) return false;
    }

    return true;
  }

  // ── 路径安全检查 ──

  isInternalPath(p: string): boolean {
    return INTERNAL_PATH_PATTERNS.some(re => re.test(p));
  }

  isDangerousWritePath(p: string): boolean {
    return DANGEROUS_WRITE_PATTERNS.some(re => re.test(p));
  }

  isSensitiveWritePath(p: string): boolean {
    return SENSITIVE_WRITE_PATTERNS.some(re => re.test(p));
  }

  /** 获取目录的父目录（用于 suggestions） */
  getParentDir(p: string): string {
    const resolved = path.resolve(p);
    const parent = path.dirname(resolved);
    return parent;
  }

  // ── 读权限检查 ──

  checkReadPermission(targetPath: string): PermissionDecision {
    const resolved = path.resolve(targetPath);

    // 内部路径 → 自动允许
    if (this.isInternalPath(resolved)) {
      return { behavior: 'allow', reason: 'internal path' };
    }

    // 在工作目录内 → 自动允许
    if (this.pathInAllowedWorkingPath(resolved)) {
      return { behavior: 'allow', reason: 'in working directory' };
    }

    // 不在工作目录内 → 询问用户
    const suggestions: PermissionUpdate[] = [
      {
        type: 'addDirectory',
        directory: this.getParentDir(resolved),
        scope: 'session',
      },
    ];

    return {
      behavior: 'ask',
      message: `路径不在允许的工作目录内: ${resolved}`,
      suggestions,
    };
  }

  // ── 写权限检查 ──

  checkWritePermission(targetPath: string, mode: PermissionMode): PermissionDecision {
    const resolved = path.resolve(targetPath);

    // 危险路径 → 直接拒绝
    if (this.isDangerousWritePath(resolved)) {
      return { behavior: 'deny', message: '不允许写入系统关键路径', reason: 'safetyCheck' };
    }

    // 敏感路径 → 询问（非拒绝）
    if (this.isSensitiveWritePath(resolved)) {
      return { behavior: 'ask', message: `是否允许写入敏感文件: ${resolved}`, reason: 'safetyCheck' };
    }

    // 内部路径 → 自动允许
    if (this.isInternalPath(resolved)) {
      return { behavior: 'allow', reason: 'internal path' };
    }

    // acceptEdits 模式 + 在工作目录内 → 自动允许
    if (mode === 'acceptEdits' && this.pathInAllowedWorkingPath(resolved)) {
      return { behavior: 'allow', reason: 'acceptEdits + in working dir' };
    }

    // 在工作目录内但非 acceptEdits → 询问
    if (this.pathInAllowedWorkingPath(resolved)) {
      return { behavior: 'ask', message: `是否允许写入: ${resolved}` };
    }

    // 不在工作目录内 → 询问并提供建议
    const suggestions: PermissionUpdate[] = [
      {
        type: 'addDirectory',
        directory: this.getParentDir(resolved),
        scope: 'session',
      },
    ];
    if (mode !== 'acceptEdits') {
      suggestions.push({ type: 'setMode', mode: 'acceptEdits', scope: 'session' });
    }

    return {
      behavior: 'ask',
      message: `路径不在允许的工作目录内: ${resolved}`,
      suggestions,
    };
  }
}
