# nano-code 插件化架构设计方案

## Context

当前 nano-code 核心代码和工具实现紧耦合——`agent.ts` 直接 import 所有工具模块，`tools/index.ts` 用 if/else 硬编码路由。随着工具增多、外部生态（MCP、市场插件）接入，这种耦合不可持续。需要重新设计为**极简核心 + 插件驱动**的架构。

---

## 一、核心设计原则

1. **Core 零依赖插件**——不加任何插件时编译运行正常（Agent 退化为纯聊天模式，无工具可用）
2. **所有插件在 `src/plugins/` 下**——不散落在 `src/tools/` 等位置
3. **钩子系统在 Core 中**——通用钩子（`onBeforeRequest` 等）由 Core 的 PluginRegistry 统一管理和执行，是插件影响 Core 的唯一途径
4. **配置空间隔离**——插件只能读写自己命名空间的配置
5. **Core 只做兜底超时**——每个工具的具体超时由插件自主定义

---

## 二、Core 层职责

```
src/
├── index.ts          CLI 入口：参数解析、交互循环、启动时加载插件
├── agent.ts          Agent 循环：ReAct 循环、消息历史、think 标签过滤
├── llm.ts            LLM Client：OpenAI 流式调用、重试退避、token 计数
├── plugin.ts         插件系统：PluginRegistry、NanoPlugin 接口、钩子系统
├── config.ts         配置系统：两级合并 + 插件命名空间隔离
├── contract.ts       工具契约：ToolResponse、ToolDefinition、ToolContext
├── prompt.ts         系统提示词组装器（Core 指令 → AGENT.md → 插件钩子）
│
└── plugins/
    ├── tools/            内置工具插件（纯逻辑，简单生命周期）
    │   ├── fs.ts         list_project_files / view_file_content
    │   │                   write_file_content / patch_file
    │   └── command.ts    run_bash_command
    │
    ├── skills/           Prompt 技能插件（无工具，仅 onSystemPrompt）
    │   └── (用户自定义 skill，读取 AGENT-xxx.md 注入指令)
    │
    └── mcp/              外部 MCP 协议适配器（复杂生命周期：进程管理、健康检查、重连）
        └── adapter.ts    MCPClient + MCPPluginAdapter
                         将配置中的 MCP Server 包装为 NanoPlugin
```

### 2.1 插件系统与钩子（`src/plugin.ts`）

```typescript
// ─── 插件契约 ───
interface NanoPlugin {
  name: string;
  description?: string;
  version?: string;

  // 工具
  getTools(): ToolDefinition[];
  execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse>;

  // 生命周期
  onInit?(registry: PluginRegistry): Promise<void>;
  onDestroy?(): Promise<void>;

  // 通用钩子（全部可选，由 Core 的 PluginRegistry 统一编排执行）
  onSystemPrompt?(prompt: string): string;
  onBeforeRequest?(messages: ChatMessage[]): ChatMessage[];
  onAfterRequest?(response: LLMResponse): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;
}

// ─── 注册表：Core 的心脏 ───
class PluginRegistry {
  register(plugin: NanoPlugin): void;
  unregister(name: string): void;

  // 工具路由
  getAllSchemas(): ToolDefinition[];     // → 送给 LLM
  execute(name: string, args: any): Promise<string>; // 自动路由到对应插件

  // 钩子执行（Agent 循环中按序调用）
  execSystemPrompt(prompt: string): string;
  execBeforeRequest(msgs: ChatMessage[]): ChatMessage[];
  execAfterRequest(resp: LLMResponse): void;
  execBeforeToolCall(tc: ToolCall): ToolCall | null;
  execAfterToolCall(result: ToolResponse): ToolResponse;

  // 配置访问（插件只能读自己的命名空间）
  getPluginConfig(name: string): Record<string, any>;

  // ─── 预留：插件市场接口 ───
  // search(query: string): Promise<PluginManifest[]>;
  // install(name: string): Promise<void>;
  // uninstall(name: string): Promise<void>;
  // listInstalled(): PluginManifest[];
}

// 钩子执行顺序（每个钩子依次遍历所有已注册插件）：
// 用户输入 → execBeforeRequest → 发送 LLM → execAfterRequest
// → execBeforeToolCall → plugin.execute → execAfterToolCall → 下一轮
```

### 2.2 配置系统（`src/config.ts`）

```typescript
interface NanoConfig {
  core: {
    model: string;
    temperature: number;
    maxTokens: number;
    defaultTimeout: number;    // 工具兜底超时（默认 120s）
    pluginsDir: string;        // 本地插件搜索路径
  };
  plugins: {
    [pluginName: string]: {                 // 命名空间隔离
      type?: 'builtin' | 'mcp' | 'npm';     // 插件来源
      enabled?: boolean;
      settings?: Record<string, any>;        // 插件自己的配置
      // MCP 相关
      transport?: 'stdio' | 'http';
      command?: string;
      args?: string[];
      url?: string;
    };
  };
}
```

两级配置源，后者覆盖前者：
1. `~/.nano-code/config.json` — 用户全局配置
2. 项目根目录 `.nano-code.json` — 项目局部配置

### 2.3 系统提示词组装流程（`src/prompt.ts`）

```typescript
// prompt.ts 不"拥有"系统提示词，它只是一个组装流水线：

function buildSystemPrompt(registry: PluginRegistry): string {
  const parts: string[] = [];

  // ① Core Agent 内置指令
  parts.push(CORE_AGENT_INSTRUCTIONS);

  // ② 项目级指令文件（自动发现，类似 CLAUDE.md / AGENT.md）
  const userFile = findProjectInstructionFile(); // AGENT.md > CLAUDE.md
  if (userFile) parts.push(userFile);

  // ③ 插件贡献（每个插件在 onSystemPrompt 中可自行读取自己的 AGENT-xxx.md）
  const finalPrompt = registry.execSystemPrompt(parts.join('\n\n'));
  // ↑ 每个插件的 onSystemPrompt 依次处理，可追加指令

  return finalPrompt;
}
```

插件在 `onSystemPrompt` 中可以：
- 追加自己的行为指令（例如 memory 插件注入记忆相关的约束）
- 读取自己的 `AGENT-xxx.md` 文件追加
- 但不能删除或修改 Core 或其他插件已追加的内容（只读追加模式）

---

## 三、插件层（`src/plugins/` 按来源划分子目录）

**所有插件共享同一个 `NanoPlugin` 接口**——任何插件都可以同时拥有工具（`getTools`/`execute`）和钩子（`onSystemPrompt` 等）。子目录仅区分插件的来源/加载方式，不区分能力。

### `plugins/tools/` — 内置插件（随 nano-code 发布）

纯 in-process 逻辑，生命周期简单：`onInit → execute → onDestroy`。

| 文件 | 提供工具 | 来源 |
|------|---------|------|
| `fs.ts` | list_project_files, view_file_content, write_file_content, patch_file | 合并 fileViewer + fileWriter + filePatcher |
| `command.ts` | run_bash_command | 迁移 commandRunner |

这些插件默认启用，构成基本的编程助手能力。

### `plugins/skills/` — 用户安装的技能插件

用户从市场安装或自行编写的行为增强插件。**可以有工具，也可以纯 prompt**。

- **纯 prompt 型**：只实现 `onSystemPrompt`，无工具（如"回复用英文"）
- **带工具型**：既注入 prompt 又提供工具（如 code-review skill 提供 `review_diff` 工具）
- **引用工具型**：不定义新工具，但在 prompt 中指导 Agent 如何使用其他插件提供的工具

安装方式：`nano-code install <skill-name>` → 下载到 `plugins/skills/` 目录

### `plugins/mcp/` — MCP 协议适配器（自动包装外部 MCP Server）

生命周期最复杂：进程启动 → 握手 → 健康检查 → 错误重连 → 销毁清理。

| 文件 | 职责 |
|------|------|
| `adapter.ts` | MCPClient（JSON-RPC 2.0）+ MCPPluginAdapter |
| | 读取配置中 type: "mcp" 的条目，自动为每个 MCP Server 创建一个 NanoPlugin 包装 |
| | 生命周期管理：进程启动、健康检查、断线重连、退出清理 |

MCP 插件不写代码——用户只需在配置里声明，adapter 自动将其工具整合进系统。

### 未来可能的插件（保持独立，不纳入 Core）

| 插件 | 功能 | 核心钩子依赖 |
|------|------|-------------|
| token-budget | Token 预算管理、历史压缩 | onBeforeRequest, onAfterRequest, onBeforeToolCall |
| memory | 跨会话记忆持久化、关联回忆注入 | onBeforeRequest（注入相关记忆）, onAfterToolCall（写入新事实） |
| context-ui | 在终端显示当前上下文状态（token 用量、活跃工具等） | onAfterRequest, onAfterToolCall |
| session-persistence | 保存/恢复对话历史 | onAfterToolCall |
| web-fetch | HTTP 请求工具 | getTools, execute |
| git | Git 操作工具 | getTools, execute |

#### 记忆系统（memory plugin）如何工作？

```
每次 onAfterToolCall: 从对话中提取关键信息（决策、文件创建等）→ 存储到本地 JSON/ SQLite
每次 onBeforeRequest:  从存储中检索与当前问题相关的记忆 → 注入到 system prompt
```

完全通过通用钩子实现，无需 Core 新增接口。

#### 上下文展示系统（context-ui plugin）如何工作？

```
每次 onAfterRequest + onAfterToolCall: 在终端绘制状态面板
显示：当前 token 累计、已调用工具次数、活跃插件列表、会话时长
```

同样是纯钩子实现。

---

## 四、外部生态集成

### 4.1 MCP Server 适配（`src/plugins/mcp/adapter.ts`）

```
MCP Server 的标准协议：
  tools/list  →  转换为 ToolDefinition[]
  tools/call  →  转换为 execute(name, args)

内置 MCPClient 类（JSON-RPC 2.0 over stdio/HTTP）
+ MCPPluginAdapter 包装为 NanoPlugin
+ 无需用户改代码，配置即用
```

### 4.2 插件市场预留（apt 式能力）

PluginRegistry 中预留了三个接口：

```typescript
// 查询远程插件市场
PluginRegistry.search(query: string): Promise<PluginManifest[]>;
// 安装插件（下载到 pluginsDir）
PluginRegistry.install(name: string): Promise<void>;
// 卸载插件
PluginRegistry.uninstall(name: string): Promise<void>;

interface PluginManifest {
  name: string;
  description: string;
  version: string;
  type: 'mcp' | 'npm' | 'builtin';
  author?: string;
  configSchema?: Record<string, any>;  // 插件配置的 JSON Schema
}
```

当前阶段只预留接口签名，不实现。未来实现时：
- **type: 'npm'** → 发布为 `@nano-code/plugin-xxx`，`npm install` 后自动发现
- **type: 'mcp'** → 从市场索引文件下载 MCP server 的启动命令和参数

---

## 五、零插件模式行为

如果不注册任何插件，Agent 循环的工作流：

```
用户输入 → LLM 返回文本 → 打印到终端 → 等待下一轮输入
（无工具可用，Agent 退化为纯聊天 CLI）
```

`getAllSchemas()` 返回 `[]`，LLM 不会收到任何工具定义，也不会发起工具调用。

---

## 六、实施步骤

### Step 1: 定义基础类型和插件接口
`src/contract.ts` → ToolResponse, ToolDefinition, ToolContext
`src/plugin.ts` → NanoPlugin, PluginRegistry（含钩子系统）

### Step 2: 配置系统
`src/config.ts` → NanoConfig, 两级加载, 命名空间隔离

### Step 3: 重构 Agent
`src/agent.ts` → 接收 PluginRegistry, 路由走 registry
`src/prompt.ts` → 系统提示词构建（含 registry 的 execSystemPrompt）
`src/llm.ts` → 保留流式调用, 新增重试退避

### Step 4: 将现有工具抽取为插件
创建 `src/plugins/tools/fs.ts`, `src/plugins/tools/command.ts`
创建 `src/plugins/mcp/adapter.ts`（骨架）
删除 `src/tools/` 目录

### Step 5: 更新 CLI 入口
`src/index.ts` → 启动时加载内置插件, 连接 PluginRegistry

---

## 七、验证方式

1. `npm run build` — 编译通过
2. `npm test` — 测试通过
3. 零插件模式：`const agent = new NanoCodeAgent(new PluginRegistry())` 可正常运行（纯聊天）
4. 有插件模式：工具调用、钩子编排正常
5. 配置隔离：Plugin A 无法读取 Plugin B 的命名空间
6. 预留接口：`registry.search()` 等编译存在，调用抛 "not implemented" 而非编译错误
