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

# 编译并全局安装 release 版本（安装后可直接使用 nano-code 命令）
npm run build
npm install -g .
nano-code

# 或仅编译后运行（不全局安装）
npm run build
npm start
```

## 命令行选项

| 选项 | 说明 |
|------|------|
| `-d, --debug` | 开启调试模式，打印与 LLM 交互的完整数据包 |
| `-t, --think` | 显示 LLM 的思考过程（思维链） |
| `--skip-permission` | 跳过工具调用的用户确认提示 |
| `--list-plugins` | 列出所有已注册的插件及其提供的工具（含 agent 工具） |
| `-c, --continue` | 接续最近一次在当前项目的会话继续对话 |
| `-p, --profile <name>` | 指定 agent 角色配置文件（如 `treehole`），直接进入特定角色模式 |
| `--version` | 显示版本号 |
| `--help` | 显示帮助信息 |

### 插件管理命令

```bash
nano-code plugin list                          # 列出所有插件及状态（含 agent 插件）
nano-code plugin install <source>              # 安装插件（npm 包/git 仓库/本地路径）
nano-code plugin enable <name>                 # 启用插件或 agent
nano-code plugin disable <name>                # 禁用插件或 agent
```

系统插件（白名单）禁用/启用仅通过配置文件操作。

### 展示层配置

展示层（输入/输出 UI）可通过 `display` 配置：

```yaml
# ~/.nano-code/config.yaml
display:
  plugin: repl  # 默认 REPL 交互。可指定路径或 ~/.nano-code/presentations/<name>.js
```

展示层插件不通过 `plugin-cli` 管理，独立于 PluginRegistry。未配置时默认使用 `repl`。

### Agent 生命周期事件

`DisplayPlugin` 支持 agent 任务生命周期事件，方便 UI 插件感知 agent 状态变化：

```typescript
interface DisplayPlugin {
  // ... 基础事件
  onAgentTurnStart?(event: AgentEvent): void;  // agent 开始处理
  onAgentTurnEnd?(event: AgentEvent): void;    // agent 完成一轮处理
  onStateSnapshot?(snapshot: StateSnapshot): void; // 状态快照（含 messageCount）
}
```

Store 中的 `agent` key 自动更新 agent 运行状态：

```typescript
registry.store.get('agent')
// → { agentName: 'main', status: 'running'|'idle', messageCount: 10 }
```

## 配置

### 环境变量（`.env`）

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，默认 OpenAI
OPENAI_MODEL_NAME=gpt-4o                     # 可选，默认 gpt-4o
```

支持任何兼容 OpenAI API 格式的后端：DeepSeek、通义千问、Ollama 本地模型等。

环境变量加载顺序（高优先级优先）：
1. Shell 环境变量
2. `$CWD/.env` — 项目级环境变量
3. `~/.nano-code/.env` — 全局兜底

### agent 角色配置

自定义 agent 的身份和启动提示：

```json
{
  "agent": {
    "role": "数据库管理员",
    "greeting": "我可以帮您查询数据库、分析表结构。"
  }
}
```

不配置时自动推导：有已注册工具 → "终端 AI 编程助手"，无工具 → "AI 对话助手"。

### 配置文件（`.nano-code.yaml`）

项目级 YAML 配置，可覆盖模型参数、agent 角色和插件设置：

```yaml
core:
  model: deepseek-chat
  apiKey: sk-xxx
  baseURL: https://api.deepseek.com/v1
  maxTokens: 128000     # 默认上下文窗口大小
  defaultTimeout: 120000

agent:
  role: DevOps 助手

plugins:
  fs: {}
  command: {}
  token-budget:
    settings:
      maxTokensPerSession: 100000
```

配置文件优先级高于 `.env` 文件。`apiKey` 和 `baseURL` 也可以在配置文件中指定，不配置时从 `.env` 或环境变量读取。`model`、`temperature` 等参数为可选项，不配置时使用默认值。

### 全局 YAML 配置（`~/.nano-code/config.yaml`）

首次启动时自动创建，包含系统插件白名单、环境变量、提示词模板等。编辑后重启生效：

```yaml
# 系统插件白名单 — CLI enable/disable 不可操作
system_plugins:
  - fs
  - command
  - memory
  - token-budget

# 环境变量兜底（shell 和 .env 优先级更高）
env:
  OPENAI_API_KEY: ""
  OPENAI_BASE_URL: ""

# 系统提示词模板（可用变量 {role} {tool_list}）
system_prompt:
  with_tools: |
    你是一个名为 nano-code 的 {role}。...
  no_tools: |
    你是一个名为 nano-code 的 {role}。...
```

项目级 `.nano-code.yaml` 会覆盖全局 YAML 配置。插件默认不加载，只有在配置中显式声明才会被注册（系统白名单内的插件除外）。

### Agent Profile 角色配置

通过 `--profile` 参数直接启动 nano-code 进入特定角色模式：

```bash
nano-code --profile treehole
```

Profile 文件查找顺序：项目目录 `.nano-code/profiles/<name>.json` → 全局 `~/.nano-code/profiles/<name>.json`，优先级最高的配置层可覆盖 agent 角色、插件启停和插件设置。

示例（`~/.nano-code/profiles/treehole.json`）：
```json
{
  "agent": {
    "role": "一个善解人意的树洞，温柔地倾听用户的心声",
    "greeting": "你好，我是树洞。你可以放心地说任何事情。"
  },
  "plugins": {
    "memory": {
      "enabled": true,
      "settings": { "namespace": "treehole" }
    },
    "command": { "enabled": false }
  }
}
```

Profile 可以禁用不需要的默认插件（如树洞禁用 fs/command），使 nano-code 从"编程助手"变为任意角色。

### Agent 工具子 agent

调用领域专家子 agent 完成特定任务，子 agent 拥有独立的插件集合和上下文历史：

```bash
# 在 ~/.nano-code/agents/ 下创建 YAML 定义，自动注册为工具
nano-code --list-plugins
# → agent:dba [内置]  • agent-dba  数据库专家，分析慢查询和索引优化
```

Agent 定义文件（`~/.nano-code/agents/dba.yaml`）：

```yaml
name: dba
description: 数据库专家，分析慢查询和索引优化
role: |
  你是一个专业的数据库管理员（DBA），擅长分析和优化 SQL 查询性能。
plugins:
  command:
    enabled: true
  memory:
    enabled: true
    settings:
      namespace: dba
```

主 agent 在对话中自动调用子 agent：

```
用户: "帮我看看这个查询为什么慢"
主 agent → 调用 agent-dba 工具
  [dba] ? 正在思考并请求大模型...
  [dba] # AI 申请调用本地工具: [ mysql_execute ]
  [dba] [OK] 工具执行完毕
  [dba] 分析结果：建议在 user_id 列上添加索引
主 agent → 根据结果向用户解释
```

特性：
- 自动发现 `~/.nano-code/agents/*.yaml`，注册为 `agent-<name>` 工具
- 子 agent 拥有独立 `PluginRegistry`，不共享主 agent 的插件
- 输出带 `[name]` 前缀，区分各 agent 的日志
- 递归防护：子 agent 内部不注册 agent 工具
- 子 agent 如需持久记忆，在定义中指定独立 `namespace`

## 架构

```
┌─────────────────────────────────────────────────┐
│                   Core                           │
│  CLI → Agent Loop → PluginRegistry → LLM Client │
└─────────────────────────────────────────────────┘
         ↕ register & dispatch     ↕ shared state
┌──────────────────────────────────┴────────────────┐
│                  Plugins                           │
│  fs │ command │ memory │ MCP │ token-budget │ …  │
└───────────────────────────────────────────────────┘
         ↕ 子 agent 调用（独立实例）
┌─────────────────────────────────────────────────┐
│            Agent 工具（~/.nano-code/agents/）     │
│  agent:dba  │  agent:reviewer  │  …              │
└─────────────────────────────────────────────────┘
```

- **Core** — Agent 循环（支持主/子两层）、LLM 通信、插件编排、配置管理
- **Plugins** — 所有功能通过插件提供，Core 不内置任何业务工具。插件间通过 `IStore` 共享状态，无需互相依赖
- **Agent 工具** — 领域专家子 agent，通过 YAML 定义，自动注册为工具，独立上下文执行

### 内置插件

| 插件 | 启用方式 | 提供工具 |
|------|---------|---------|
| **fs** | `"fs": {}` | 文件列表、读取、写入、精准修改 |
| **command** | `"command": {}` | Bash 命令执行（含危险命令黑名单） |
| **memory** | `"memory": {}` | 记忆存储与检索，支持多会话持久化和标签查询 |
| **store** | 内建默认 `InMemoryStore` | 插件间共享状态通道，`IStore` 接口可替换实现 |
| **agent** | 自动发现 `~/.nano-code/agents/*.yaml` | `agent-<name>` 子 agent 调用工具 |
| **display** | 通过 `display.plugin` 配置 | 展示层插件，支持生命周期事件（独立于 PluginRegistry） |

### 可选插件

| 插件 | 启用方式 |
|------|---------|
| **npm** | 配置 `type: "npm"` 和 `spec`，`import()` 加载 NanoPlugin |
| **MCP** | 配置 `type: "mcp"` 条目，自动加载外部 MCP Server |
| **Token Budget** | 配置 `plugins.token-budget.settings`，使用 API 精确 token 统计 |
| **npm-loader** | 内置默认插件，自动处理 `type: "npm"` 插件的注册 |

## MCP 集成

nano-code 支持 [Model Context Protocol](https://modelcontextprotocol.io/) 标准协议。在 `.nano-code.yaml` 中声明 MCP Server：

```yaml
plugins:
  mcp-filesystem:
    type: mcp
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
  mcp-playwright:
    type: mcp
    command: uvx
    args:
      - mcp-server-playwright
```

## 插件开发

nano-code 的插件是一个实现 `NanoPlugin` 接口的模块，可以提供工具和钩子：

```typescript
interface NanoPlugin {
  name: string;
  description?: string;
  getTools(): ToolDefinition[];
  execute(name, args, ctx): Promise<ToolResponse>;
  onInit?(registry: PluginRegistry): Promise<void>;
  onDestroy?(): Promise<void>;
  onSystemPrompt?(prompt: string): string;
  onBeforeRequest?(messages): ChatMessage[];
  onAfterRequest?(response, rawMeta?): void;  // rawMeta 由插件自行解析
  onBeforeToolCall?(toolCall): ToolCall | null;
  onAfterToolCall?(result): ToolResponse;
  onExtraParams?(): Record<string, unknown>;  // 注入 LLM API 请求参数
}
```

插件间共享状态通过 `IStore` 接口（`registry.store`），不直接依赖其他插件：

```typescript
interface IStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: unknown): void;
  subscribe(key: string, fn: () => void): () => void;
}
```

默认实现为 `InMemoryStore`（`src/plugins/store/in-memory.ts`），可替换为任何后端存储。

详细指南请参考 [`docs/plugin-development.md`](docs/plugin-development.md)。

## 测试

```bash
npm test        # 运行全部测试
```

## 技术栈

TypeScript + Node.js 原生测试框架，通过 OpenAI 兼容 API 调用 LLM，使用 ReAct 循环模式 + 插件系统驱动工具调用。
