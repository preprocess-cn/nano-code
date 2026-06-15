import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { confirm } from '@clack/prompts';
import { NanoPlugin } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';

function safeResolvePath(relativeTarget: string): string {
  const cwd = process.cwd();
  const absoluteTarget = path.resolve(cwd, relativeTarget);
  if (!absoluteTarget.startsWith(cwd)) {
    throw new Error(`安全拒绝：路径 "${relativeTarget}" 超出了当前工作区目录。`);
  }
  return absoluteTarget;
}

async function listFilesRecursive(dir: string, currentLevel = 0, maxLevel = 3): Promise<string[]> {
  if (currentLevel > maxLevel) return [];
  let results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const blacklist = ['node_modules', 'dist', '.git', '.DS_Store'];
  for (const entry of entries) {
    if (blacklist.includes(entry.name)) continue;
    const resPath = path.resolve(dir, entry.name);
    const relativeToCwd = path.relative(process.cwd(), resPath);
    if (entry.isDirectory()) {
      results.push(`${relativeToCwd}/`);
      const subFiles = await listFilesRecursive(resPath, currentLevel + 1, maxLevel);
      results = [...results, ...subFiles];
    } else {
      results.push(relativeToCwd);
    }
  }
  return results;
}

const writerConfirmation = {
  async ask(message: string): Promise<boolean> {
    const result = await confirm({ message, initialValue: true });
    return !(typeof result === 'symbol' || !result);
  }
};

const patchConfirmation = {
  async ask(path: string, search: string, replace: string): Promise<boolean> {
    console.log(`\n[!]  AI 正在申请对文件实施微创修改：\x1b[36m${path}\x1b[0m`);
    console.log(`\x1b[31m[-] 修改前:\x1b[0m\n${search}`);
    console.log(`\x1b[32m[+] 修改后:\x1b[0m\n${replace}`);
    const result = await confirm({ message: '[?] 是否批准此文件修改？', initialValue: true });
    return !(typeof result === 'symbol' || !result);
  }
};

// Re-export for test compatibility (confirmation mocking)
export { writerConfirmation, patchConfirmation };

const toolError = (msg: string): ToolResponse => ({ status: 'error', message: msg });

export const fsPlugin: NanoPlugin = {
  name: 'fs',
  description: 'File system read/write/patch tools',
  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'list_project_files',
          description: '列出当前工作目录下的所有文件和文件夹结构（已自动排除 node_modules 和编译产物）。当需要了解项目整体架构、寻找特定代码文件时使用。',
          parameters: { type: 'object', properties: {} },
        }
      },
      {
        type: 'function',
        function: {
          name: 'view_file_content',
          description: '读取项目中指定文件的完整文本内容。当需要分析某个文件的代码逻辑、定位 Bug 或了解上下文时使用。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对于当前项目根目录的文件路径（例如：src/index.ts）' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file_content',
          description: '创建新文件或完全覆写已有文件。当需要新建代码、修改 Bug、或者重构整个文件时使用。必须提供完整的目标文件内容。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对于当前项目根目录的文件写入路径（例如：src/utils.ts）' },
              content: { type: 'string', description: '准备写入该文件的完整代码或文本内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'patch_file',
          description: 'Perform a precise single-replacement "surgery" on a specific file. Use this for small, targeted code modifications rather than overwriting the whole file.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The relative or absolute path of the file to modify.' },
              search: { type: 'string', description: 'The exact string or lines of code block to be replaced. Must match the file content exactly, including whitespace and indentation.' },
              replace: { type: 'string', description: 'The new string or lines of code block to inject.' }
            },
            required: ['path', 'search', 'replace']
          }
        }
      },
    ];
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    switch (name) {
      case 'list_project_files': {
        try {
          const files = await listFilesRecursive(process.cwd());
          if (files.length === 0) {
            return { status: "success", data: "this project directory is empty." };
          }
          return { status: "success", data: `"this project directory tree: \n"${files.map(f => `- ${f}`).join('\n')}` };
        } catch (err: any) {
          return toolError(`cannot list file directory: "${err.message}`);
        }
      }

      case 'view_file_content': {
        try {
          if (!args.path) return toolError("args.path missing, please provide");
          const finalPath = safeResolvePath(args.path);
          const content = await fs.readFile(finalPath, 'utf-8');
          return { status: "success", data: `--- 文件内容 开始: ${args.path} ---\n${content}\n--- 文件内容 结束 ---` };
        } catch (err: any) {
          return toolError(`read file [${args.path}] failed: ${err.message}`);
        }
      }

      case 'write_file_content': {
        try {
          if (!args.path || args.content === undefined) {
            return toolError('Error: Missing required parameters "path" or "content".');
          }
          const finalPath = safeResolvePath(args.path);
          let fileExists = false;
          try { await fs.access(finalPath); fileExists = true; } catch { fileExists = false; }

          if (!ctx.skipPermission) {
            const actionText = fileExists ? '[!] 覆盖修改' : '[NEW] 创建新文件';
            const isConfirmed = await writerConfirmation.ask(`AI 申请 ${actionText} [ ${args.path} ]，是否批准此操作？`);
            if (!isConfirmed) {
              return { status: "rejected_by_user", message: 'The user explicitly rejected the file write operation' };
            }
          }

          const dirPath = path.dirname(finalPath);
          await fs.mkdir(dirPath, { recursive: true });
          await fs.writeFile(finalPath, args.content, 'utf-8');
          return { status: 'success', data: `Successfully wrote content to file "${args.path}".` };
        } catch (err: any) {
          return toolError(`File write collapsed: ${err.message}`);
        }
      }

      case 'patch_file': {
        try {
          const { path: relativePath, search, replace } = args;
          if (!relativePath || search === undefined || replace === undefined) {
            return toolError('Error: Missing required parameters: "path", "search", or "replace".');
          }
          if (search === '') return toolError('Error: "search" string must not be empty.');

          const absolutePath = path.resolve(process.cwd(), relativePath);
          if (!fsSync.existsSync(absolutePath)) {
            return toolError(`Error: File does not exist at path: ${relativePath}`);
          }

          if (!ctx.skipPermission) {
            const isConfirmed = await patchConfirmation.ask(relativePath, search, replace);
            if (!isConfirmed) {
              return { status: 'rejected_by_user', message: 'File modification rejected by user.' };
            }
          }

          const fileContent = fsSync.readFileSync(absolutePath, 'utf8');
          if (!fileContent.includes(search)) {
            return toolError('Error: Could not patch file. The "search" string was not found in the file. Please ensure your indentation and characters match exactly.');
          }

          const updatedContent = fileContent.replace(search, replace);
          fsSync.writeFileSync(absolutePath, updatedContent, 'utf8');
          return { status: 'success', data: `File patched successfully: ${relativePath}. Applied 1 precise modification.` };
        } catch (err: any) {
          return toolError(`Unexpected error during patch_file: ${err.message}`);
        }
      }

      default:
        throw new Error(`未找到匹配的 FS 工具: ${name}`);
    }
  },
};
