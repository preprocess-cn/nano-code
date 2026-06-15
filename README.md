# nano-code

轻量级终端 AI 编程助手。极简核心 + 插件驱动架构，通过自然语言与代码仓库交互。

## 快速开始

```bash
# 安装依赖
npm install

# 配置 API Key（编辑 .env 文件）
# 支持 OpenAI / DeepSeek / Ollama 等任何兼容 API

# 直接运行（无需编译）
npx tsx src/index.ts

# 或编译后运行
npm run build
npm start
```

## 命令行选项

| 选项 | 说明 |
|------|------|
| `-d, --debug` | 开启调试模式，打印与 LLM 交互的完整数据包 |
| `-t, --think` | 显示 LLM 的思考过程（思维链） |
| `--skip-permission` | 跳过工具调用的用户确认提示 |
| `--help` | 显示帮助信息 |

## 配置

### 环境变量（`.env`）

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，默认 OpenAI
OPENAI_MODEL_NAME=gpt-4o                     # 可选，默认 gpt-4o
```

支持任何兼容 OpenAI API 格式的后端：DeepSeek、通义千问、Ollama 本地模型等。

### 配置文件（`.nano-code.json`）

项目级配置，可覆盖模型参数和插件设置：

```json
{
  "core": {
    "model": "deepseek-chat",
    "temperature": 0,
    "maxTokens": 4096,
    "defaultTimeout": 120000
  },
  "plugins": {
    "token-budget": {
      "settings": {
        "maxTokensPerSession": 100000
      }
    }
  }
}
```

全局配置位于 `~/.nano-code/config.json`，项目级配置会覆盖全局配置。

## 架构

```
┌─────────────────────────────────────────────────┐
│                     Core                         │
│  CLI → Agent Loop → PluginRegistry → LLM Client │
└─────────────────────────────────────────────────┘
         ↕ register & dispatch
┌─────────────────────────────────────────────────┐
│                  Plugins                         │
│  fs.ts  │  command.ts  │  MCP  │  token-budget  │
└─────────────────────────────────────────────────┘
```

- **Core** — Agent 循环、LLM 通信、插件编排、配置管理
- **Plugins** — 所有功能通过插件提供，Core 不内置任何业务工具

### 内置插件

| 插件 | 文件 | 提供工具 |
|------|------|---------|
| **fs** | `src/plugins/tools/fs.ts` | 文件列表、读取、写入、精准修改 |
| **command** | `src/plugins/tools/command.ts` | Bash 命令执行（含危险命令黑名单） |

### 可选插件

| 插件 | 启用方式 |
|------|---------|
| **MCP Adapter** | 在 `.nano-code.json` 中配置 `type: "mcp"` 的插件条目，自动加载外部 MCP Server |
| **Token Budget** | 在 `.nano-code.json` 中配置 `plugins.token-budget.settings` |

## MCP 集成

nano-code 支持 [Model Context Protocol](https://modelcontextprotocol.io/) 标准协议。在 `.nano-code.json` 中声明 MCP Server：

```json
{
  "plugins": {
    "mcp-filesystem": {
      "type": "mcp",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "mcp-playwright": {
      "type": "mcp",
      "command": "uvx",
      "args": ["mcp-server-playwright"]
    }
  }
}
```

## 插件开发

nano-code 的插件是一个实现 `NanoPlugin` 接口的模块，可以提供工具和钩子：

```typescript
interface NanoPlugin {
  name: string;
  getTools(): ToolDefinition[];
  execute(name, args, ctx): Promise<ToolResponse>;
  onSystemPrompt?(prompt: string): string;
  onBeforeRequest?(messages): ChatMessage[];
  onAfterRequest?(response): void;
  onBeforeToolCall?(toolCall): ToolCall | null;
  onAfterToolCall?(result): ToolResponse;
}
```

详细指南请参考 [`docs/plugin-development.md`](docs/plugin-development.md)。

## 测试

```bash
npm test        # 运行全部测试（64 个）
```

## 技术栈

TypeScript + Node.js 原生测试框架，通过 OpenAI 兼容 API 调用 LLM，使用 ReAct 循环模式 + 插件系统驱动工具调用。
