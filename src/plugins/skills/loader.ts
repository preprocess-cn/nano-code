import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SkillDefinition {
  name: string;
  description: string;
  /** inline: 内容作为 newMessages 注入主循环; fork: 子 agent 独立执行 */
  context: 'inline' | 'fork';
  /** 技能目录绝对路径 */
  dir: string;
  /** SKILL.md 完整内容（含 frontmatter） */
  rawContent: string;
  /** 去掉 frontmatter 后的 markdown 正文 */
  body: string;
}

/** 获取技能根目录。优先使用 NANO_CODE_SKILLS_DIR 环境变量（测试用），否则默认 ~/.nano-code/skills */
export function getSkillsDir(): string {
  const envDir = process.env['NANO_CODE_SKILLS_DIR'];
  return envDir ? path.resolve(envDir) : path.join(os.homedir(), '.nano-code', 'skills');
}

/** 解析 SKILL.md frontmatter */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const frontmatter: Record<string, unknown> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIdx = content.indexOf('\n---', 3);
    if (endIdx !== -1) {
      const yamlBlock = content.slice(3, endIdx).trim();
      body = content.slice(endIdx + 4).trim();
      for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: unknown = line.slice(colonIdx + 1).trim();
        if (typeof value === 'string') {
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
        }
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

/** 扫描技能目录，返回所有已加载的技能定义 */
export function loadAllSkills(): SkillDefinition[] {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) return [];

  const results: SkillDefinition[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillDir = path.join(dir, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.statSync(skillDir).isDirectory()) continue;
    if (!fs.existsSync(skillFile)) continue;

    try {
      const rawContent = fs.readFileSync(skillFile, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(rawContent);
      const name = (frontmatter.name as string) || entry;
      const description = (frontmatter.description as string) || '';
      const context = (frontmatter.context as string) === 'fork' ? 'fork' : 'inline';

      results.push({ name, description, context, dir: skillDir, rawContent, body });
    } catch {
      continue;
    }
  }

  return results;
}

/** 按名称查找技能 */
export function findSkill(name: string): SkillDefinition | undefined {
  return loadAllSkills().find(s => s.name === name);
}

/** 查找技能的引用/模板/脚本文件 */
export function listSkillFiles(skillDir: string): string[] {
  const files: string[] = [];
  for (const subdir of ['references', 'templates', 'scripts', 'assets']) {
    const dir = path.join(skillDir, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      files.push(`${subdir}/${f}`);
    }
  }
  return files;
}

/** 替换技能正文中的 {args} 占位符 */
export function substituteArgs(content: string, argsStr: string): string {
  if (!argsStr) return content;
  return content.replace(/\{args\}/g, argsStr);
}

/** 读取技能目录内的文件 */
export function readSkillFile(skillDir: string, filePath: string): string | null {
  const target = path.resolve(skillDir, filePath);
  if (!target.startsWith(path.resolve(skillDir))) return null; // 路径逃逸拦截
  if (!fs.existsSync(target)) return null;
  try {
    return fs.readFileSync(target, 'utf-8');
  } catch {
    return null;
  }
}
