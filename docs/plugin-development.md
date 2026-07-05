# nano-code 插件开发指南

## 概述

nano-code 采用 **极简核心 + 插件驱动** 架构。Core 只负责 Agent 循环、LLM 通信和插件编排，不内置任何业务工具。

插件（Plugin）是一个实现了 `NanoPlugin` 接口的模块，可以：

- **提供工具**（`getTools` / `execute`）—— 让 AI 调用你定义的操作
- **注入行为**（`onSystemPrompt` / `onBeforeAgentInput`）—— 修改系统提示词或拦截用户输入
- **观测和控制**（`onBeforeRequest` / `onAfterRequest` / `onBeforeToolCall` / `onAfterToolCall`）—— 拦截消息、追踪用量、拒绝调用
- **注入额外参数**（`onExtraParams`）—— 向 LLM API 请求体中注入自定义参数

---

## 核心接口

### NanoPlugin（`src/core/plugin.ts`）

```typescript
interface NanoPlugin {
  name: string;
  description?: string;
  version?: string;

  // 工具定义（必须）
  getTools(): ToolDefinition[];
  execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse>;

  // 生命周期（可选）
  onInit?(registry: PluginRegistry): Promise<void>;
  onDestroy?(): Promise<void>;

  // 通用钩子（可选）
  onSystemPrompt?(prompt: string): string;
  onBeforeRequest?(messages: ChatMessage[]): ChatMessage[];
  onAfterRequest?(response: LLMResponse, rawMeta?: Record<string, unknown>): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;

  // 用户输入拦截（可选，用于实现斜杠命令、!bash 等）
  onBeforeAgentInput?(input: string): Promise<CommandInterceptResult | null>;

  // 注入 LLM API 请求体的额外参数（可选）
  onExtraParams?(): Record<string, unknown>;
}
```

### 关键类型

所有类型定义位于 `src/core/contract.ts`。

#### ToolDefinition —— 工具描述

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;               // 工具名，全局唯一
    description: string;        // 描述，LLM 据此决定是否调用
    parameters: Record<string, any>; // JSON Schema 格式参数定义
    sideEffect?: boolean;       // false = 只读，自动执行无需用户确认；默认 true
  };
}
```

**`sideEffect` 字段说明：**
- `true`（默认）：该工具会修改外部状态（文件、数据库等），需要用户确认权限
- `false`：该工具是只读操作（查询、搜索等），自动执行跳过权限确认

#### ToolResponse —— 工具执行结果

```typescript
interface ToolResponse {
  status: 'success' | 'rejected_by_user' | 'error';
  data?: string;               // 成功时返回给 LLM 的数据
  message?: string;            // 失败/被拒时返回的错误消息
  newMessages?: InjectedMessage[]; // 注入主循环的额外消息（inline skill 展开用）
}
```

`newMessages` 用于在工具执行后向 Agent 消息历史插入额外的 user/assistant 消息。典型用途：inline skill 展开——将 skill 内容以 user 消息形式注入。

#### InjectedMessage —— 注入消息

```typescript
interface InjectedMessage {
  role?: 'user' | 'assistant'; // 默认 'user'
  content: string;
}
```

#### ToolContext —— 执行上下文

```typescript
interface ToolContext {
  skipPermission: boolean;                       // 是否跳过用户确认
  cwd: string;                                   // 当前工作目录
  defaultTimeout: number;                        // 默认超时（毫秒）
  sideEffect: boolean;                           // 当前工具是否有后效性
  confirmCallback?: (req: PermissionConfirmRequest)
    => Promise<PermissionConfirmResponse>;       // 权限确认回调
  outputHandler?: CommandOutputHandler;          // 命令输出流处理器
}
```

`confirmCallback` 由展示层注入。工具需要用户确认时，回调此函数。`outputHandler` 用于工具实时输出 stdout/stderr 到展示层。

#### PermissionConfirmRequest / PermissionConfirmResponse

```typescript
interface PermissionConfirmRequest {
  toolName: string;
  message: string;
  details?: string;
  diff?: DiffHunk[];    // 文件编辑操作时的 diff 片段
  filePath?: string;    // 目标文件路径（用于 diff 语法高亮）
}

type PermissionConfirmResponse = boolean | 'always_allow';
```

#### CommandInterceptResult —— 输入拦截结果

```typescript
interface CommandInterceptResult {
  handled: true;                                   // 是否已处理
  exit?: boolean;                                  // true = 退出进程
  skipAgent?: boolean;                             // true = 跳过 agent.runTask
  injectMessages?: InjectedMessage[];              // 注入 agent 历史的消息
  replaceInput?: string;                           // 替换发送给 agent 的用户输入
  message?: string;                                // 要显示的状态消息
}
```

### LLMResponse（`src/core/plugin.ts`）

```typescript
interface LLMResponse {
  text: string | null;
  toolCalls?: ToolCall[];
  stopReason?: string;
}

interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;  // JSON 字符串
  };
}
```

### AgentDisplay —— Agent → Display 窄接口

```typescript
interface AgentDisplay {
  onStatus?(event: { message: string; agentName: string; level: string }): void;
  onStreamChunk?(event: { text: string; agentName: string }): void;
  onToolCall?(event: { toolName: string; args: any; agentName: string }): void;
  onToolResult?(event: { status: ToolStatus; message?: string; agentName: string }): void;
  onStateSnapshot?(snapshot: { agentName: string; messageCount: number }): void;
  onAgentTurnStart?(event: { agentName: string }): void;
  onAgentTurnEnd?(event: { agentName: string }): void;
}
```

---

## 快速开始：写一个"时间工具"插件

在 `src/plugins/tools/` 下创建 `datetime.ts`：

```typescript
import { NanoPlugin } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';

export const datetimePlugin: NanoPlugin = {
  name: 'datetime',
  description: '获取当前日期和时间',

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: '获取当前的日期和时间信息。当用户询问"现在几点"时使用。',
          parameters: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                description: '时间格式：iso / full / date / time',
                enum: ['iso', 'full', 'date', 'time'],
              },
            },
          },
          sideEffect: false,  // 只读操作，无需确认
        },
      },
    ];
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    if (name !== 'get_current_time') {
      return { status: 'error', message: `Unknown tool: ${name}` };
    }

    const now = new Date();
    const format = args.format || 'iso';
    const data = ({
      iso: now.toISOString(),
      full: now.toString(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
    } as Record<string, string>)[format] || now.toISOString();

    return {
      status: 'success',
      data: `当前时间: ${data}`,
    };
  },
};
```

### 注册到系统

在 `src/core/plugin.ts` 的 `BUILTIN_LOADERS` 表中添加一行：

```typescript
const BUILTIN_LOADERS: Record<string, (settings?: any) => Promise<NanoPlugin>> = {
  fs: async () => (await import('#src/plugins/tools/fs.js')).fsPlugin,
  command: async () => (await import('#src/plugins/tools/command.js')).commandPlugin,
  datetime: async () => (await import('#src/plugins/tools/datetime.js')).datetimePlugin, // 新增
  // ...
};
```

### 配置启用

在 `.nano-code.yaml` 中配置插件：

```yaml
plugins:
  datetime: {}    # 空对象表示使用默认设置
```

插件默认不加载，只有在配置中显式声明的才会被注册。

---

## 插件类型与注册方式

| 类型 | 配置方式 | 特点 |
|------|---------|------|
| **内置插件** | `name: {}` | 随 nano-code 发布，in-process 加载 |
| **MCP 插件** | `name: { type: mcp }` | 包装外部 MCP Server（stdio / HTTP） |
| **npm 插件** | `name: { type: npm, spec: pkg }` | 从 npm 包动态 import |
| **系统插件** | `system_plugins` YAML 字段 | 始终启用、不可禁用 |

### MCP 插件

MCP 服务器通过 `.mcp.json` 文件配置，配置文件搜索优先级：`~/.nano-code/.mcp.json` > `$CWD/.mcp.json` > `~/.claude/.mcp.json`。

#### stdio 传输（子进程）：

```yaml
# .nano-code.yaml
plugins:
  my-db:
    type: mcp
    enabled: true
```

```json
// ~/.nano-code/.mcp.json
{
  "mcpServers": {
    "my-db": {
      "command": "node",
      "args": ["path/to/server.mjs"],
      "env": { "DB_URL": "$DB_URL" }
    }
  }
}
```

#### HTTP 传输：

```yaml
plugins:
  remote-api:
    type: mcp
    enabled: true
```

```json
{
  "mcpServers": {
    "remote-api": {
      "url": "https://api.example.com/mcp"
    }
  }
}
```

MCP 插件的 `sideEffect` 可在配置中覆写：

```yaml
plugins:
  my-db:
    type: mcp
    sideEffect: false  # 所有工具标记为只读
```

### npm 插件

```yaml
plugins:
  my-helper:
    type: npm
    spec: "@scope/my-nano-plugin"   # npm 包名或 import 路径
    enabled: true
```

npm 包应使用 `export default` 导出一个 `NanoPlugin` 对象，由 `npm-loader` 通过 `import()` 动态加载。

---

## 配置文件详解

nano-code 使用 YAML 格式的配置文件。优先级：项目 `.nano-code.yaml` > 全局 `~/.nano-code/config.yaml`。

### 完整配置结构

```yaml
# 系统插件白名单 — 这些插件始终启用，不可通过 CLI enable/disable 操作
system_plugins:
  - fs
  - command
  - memory
  - token-budget
  - skills
  - search

# 插件配置
plugins:
  plugin_name:
    type: builtin        # builtin / mcp / npm
    enabled: true        # 是否启用
    sideEffect: false    # 是否只读（MCP 插件专用覆写）
    settings:            # 插件自定义配置
      key: value
    # MCP 专有字段：
    initTimeout: 10000   # MCP 初始化超时（毫秒）

# Agent 身份
agent:
  role: "终端 AI 编程助手"    # 角色描述，注入 system prompt
  greeting: "你好，我是助手"   # 启动问候
  goodbye: "再见"             # 退出消息

# 展示层配置
display:
  plugin: repl          # 展示层插件名（repl / cli / ink）
  enabled: true

# 系统提示词模板
system_prompt:
  with_tools: |
    你是一个 {role}。你可以调用：{tool_list}。
  no_tools: |
    你是一个 {role}。纯文本对话。
  project_files:
    - AGENT.md
    - AGENT.txt

# MCP 配置
mcp:
  stderrLevel: warn     # MCP stderr 日志过滤级别

# 技能系统
skills:
  disabled: []          # 禁用的内置技能
  disableSkillTool: false  # 禁用 skill/skills_list/skill_view 工具
```

### 插件配置隔离

每个插件只能读取自己命名空间的配置，通过 `registry.getPluginConfig('plugin-name')` 获取。配置在 `onInit` 时读取或在注册前通过 `registry.setPluginConfig()` 设置。

---

## 工具定义（getTools）最佳实践

```typescript
getTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: '搜索互联网获取最新信息。当用户询问实时数据、新闻或你不确定的知识时使用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            max_results: { type: 'number', description: '最大返回条数', default: 5 },
          },
          required: ['query'],
        },
        sideEffect: false,  // 只读
      },
    },
  ];
}
```

- `name` 用 snake_case，全局唯一
- `description` 要精确，直接决定 LLM 是否在正确场景调用
- `parameters` 使用完整的 JSON Schema，每个 property 都要有清晰的 `description`
- `sideEffect: false` 标记只读工具，无需用户确认，可以批量并行执行
- `sideEffect: true`（默认）标记有副作用的工具，串行执行且需权限确认

---

## 工具执行（execute）

```typescript
async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
  // name:   工具名（由 getTools 定义）
  // args:   AI 填充的参数对象
  // ctx:    执行上下文（含 skipPermission, cwd, defaultTimeout 等）

  // 成功返回：
  return { status: 'success', data: '执行结果文本' };

  // 失败返回：
  return { status: 'error', message: '错误描述' };

  // 展开 inline skill：注入额外消息到主循环
  return {
    status: 'success',
    data: 'skill 已展开',
    newMessages: [{ role: 'user', content: 'skill 内容...' }],
  };
}
```

`data` 的内容会作为工具执行结果喂给 LLM，返回信息应简洁、结构化、便于 AI 理解。

---

## 生命周期钩子

### onInit —— 插件初始化

在插件注册时自动调用。适合做初始化工作（创建目录、连接数据库、启动服务进程）：

```typescript
async onInit(registry: PluginRegistry): Promise<void> {
  const config = registry.getPluginConfig(this.name);
  await connectToDatabase(config.connectionString);

  // 通过 Store 向其他插件共享信息
  registry.store.set('my-plugin:status', { ready: true });
}
```

`onInit` 的参数是 `PluginRegistry` 实例，可通过它：
- `registry.getPluginConfig(name)` —— 读取该插件的配置（`settings` 部分）
- `registry.store.get/set(key, value)` —— 读写插件间共享状态
- `registry.setPluginConfig(name, config)` —— 为其他插件设置配置

**注意：** `onInit` 抛异常不会阻止插件注册，工具仍然可用。

### onDestroy —— 插件销毁

进程退出或插件卸载时调用：

```typescript
async onDestroy(): Promise<void> {
  await closeDatabaseConnection();
  await cleanupTempFiles();
}
```

---

## 通用钩子详解

### onSystemPrompt —— 扩展系统提示词

```typescript
onSystemPrompt(prompt: string): string {
  return `${prompt}\n- 你是编程助手，优先使用 TypeScript 回答代码问题。`;
}
```

多个插件的 `onSystemPrompt` 按注册顺序链式执行，前一个输出作为后一个输入。

### onBeforeRequest —— 修改发送给 LLM 的消息

```typescript
onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
  // 注入额外上下文、压缩长历史等
  const totalContent = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  if (totalContent > 10000) {
    return addCompressionInstruction(messages);
  }
  return messages;
}
```

### onAfterRequest —— 观测 LLM 响应

第二个参数 `rawMeta` 包含 LLM 返回的原始元数据（如 token 用量），Core 不知晓其结构，由插件自行解析：

```typescript
onAfterRequest(response: LLMResponse, rawMeta?: Record<string, unknown>): void {
  // rawMeta 包含类似 { promptTokens, completionTokens, totalTokens } 等
  if (rawMeta?.promptTokens != null) {
    tokenTracker.record(rawMeta.promptTokens as number, rawMeta.completionTokens as number);
  }
}
```

### onBeforeToolCall —— 拦截/拒绝工具调用

返回 `null` 拒绝调用。短路线：任何一个插件返回 `null`，后续插件不再执行：

```typescript
onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
  const args = JSON.parse(toolCall.function.arguments);
  if (isDangerous(args.command)) {
    console.warn(`[security] 拦截危险命令: ${args.command}`);
    return null;  // 拒绝
  }
  return toolCall;  // 放行
}
```

### onAfterToolCall —— 观测/修改工具调用结果

```typescript
onAfterToolCall(result: ToolResponse): ToolResponse {
  logManager.info('tool', `工具执行结果: ${result.status}`);
  return result;  // 也可以修改后返回
}
```

多个插件按注册顺序链式执行。

### onBeforeAgentInput —— 拦截用户输入

在用户输入发送给 Agent 前拦截。用于实现斜杠命令、`!` 前缀 bash 等直接处理：

```typescript
async onBeforeAgentInput(input: string): Promise<CommandInterceptResult | null> {
  if (input.startsWith('/mycmd')) {
    return {
      handled: true,
      skipAgent: true,
      message: '这是 /mycmd 的执行结果',
    };
  }
  return null;  // 不处理，交由后续插件或 Agent
}
```

返回值：
- `{ handled: true, exit: true }` —— 退出进程
- `{ handled: true, skipAgent: true, message: "..." }` —— 显示消息，跳过 Agent
- `{ handled: true, injectMessages: [...] }` —— 注入消息到 Agent 历史
- `{ handled: true, replaceInput: "..." }` —— 替换后发给 Agent
- `null` —— 不处理，交给下一个插件

注意：如果一个插件返回了 `handled: true`，后续插件的 `onBeforeAgentInput` 不会再被调用。

### onExtraParams —— 注入 LLM API 请求体参数

```typescript
onExtraParams?(): Record<string, unknown> {
  return {
    metadata: { session_id: this.sessionId },
    // 可注入任何 OpenAI API 参数
  };
}
```

多个插件的返回值会合并后一起发送。

---

## PluginRegistry —— 插件注册表

`PluginRegistry` 管理所有插件的生命周期、工具路由和钩子链执行。插件在 `onInit` 时持有其引用。

### 常用方法

| 方法 | 说明 |
|------|------|
| `register(plugin)` | 注册一个插件，调用 `onInit` |
| `unregister(name)` | 反注册，调用 `onDestroy` |
| `destroy()` | 销毁所有插件，清空注册表 |
| `execute(name, args)` | 执行指定工具 |
| `getAllSchemas()` | 获取所有已注册工具的工具定义 |
| `listPlugins()` | 获取插件快照（含工具列表） |
| `getPluginConfig(name)` | 读取指定插件的配置 |
| `setPluginConfig(name, config)` | 为指定插件设置配置 |
| `isToolAllowed(name)` | 检查工具是否在会话 allowlist 中 |
| `allowTool(name)` | 将工具加入 allowlist |
| `clearPermissions()` | 清空 allowlist |
| `getAllowedTools()` | 获取已允许免确认的工具列表 |
| `getToolSideEffect(name)` | 获取工具的 sideEffect 标记 |
| `setConfirmCallback(cb)` | 设置权限确认回调（由展示层注入） |
| `setOutputHandler(handler)` | 设置命令输出处理器（由展示层注入） |
| `setAgentName(name)` | 设置当前 agent 名称 |
| `getAgentName()` | 获取当前 agent 名称 |

### Store —— 插件间共享状态

`registry.store` 实现了 `IStore` 接口，用于插件间安全地共享运行时状态：

```typescript
interface IStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, fn: () => void): () => void;
}
```

谁 set 谁定义 key 名和值结构，谁 get/subscribe 谁理解 key 含义。Core 只做透传，不知晓业务含义。Store key 常量集中在 `store-keys.ts` 的 `SK` 对象中。

#### 常用 Store Key

| Key（SK.*） | 类型 | 提供者 | 消费者 |
|------------|------|--------|--------|
| `AgentStatus` | `{agentName, status, messageCount}` | Agent | 展示层 |
| `AgentMessages` | `ChatMessage[]` | Agent | token-budget, compact |
| `AgentCancelled` | `boolean` | Agent | 各模块 |
| `AgentAbort` | `AbortController` | Agent | LLM 流式取消 |
| `CompactResult` | `ChatMessage[]` | token-budget | Agent |
| `TokenBudgetGetApiUsage` | `function` | token-budget | /context 命令, 其他插件 |
| `ModelOverride` | `ModelEntry` | model-registry | LLMClient |
| `ModelRegistryModels` | `ModelEntry[]` | model-registry | /model 命令 |
| `MemoryProjectDir` | `string` | memory | 其他插件 |
| `MemoryIndexPath` | `string` | memory | 其他插件 |
| `Mode` | `string` | task-plan | prompt.ts |

---

## DisplayPlugin —— 展示层插件

展示层控制用户交互界面。nano-code 内置了 REPL 和 CLI 两种展示层，但第三方可以实现自定义展示层。

```typescript
interface DisplayPlugin {
  name: string;

  ownsOutput?: boolean;    // true = 独占全部终端输出
  rawInput?: boolean;      // true = 需要按键级原始输入

  onInit?(registry: PluginRegistry): Promise<void>;
  onStart?(config: StartConfig): void;
  onStop?(message: string): void;
  prompt?(): Promise<string | null>;  // 返回用户输入，null 表示无输入

  onUserInput?(input: string, sourcePlugin: string): void;
  onStatus?(event: StatusEvent): void;
  onStreamChunk?(event: StreamEvent): void;
  onToolCall?(event: ToolCallEvent): void;
  onToolResult?(event: ToolResultEvent): void;
  onError?(event: ErrorEvent): void;
  onDebug?(event: DebugEvent): void;
  onBackgroundTask?(event: BackgroundTaskEvent): void;
  onAgentTurnStart?(event: AgentEvent): void;
  onAgentTurnEnd?(event: AgentEvent): void;
  onStateSnapshot?(snapshot: StateSnapshot): void;

  // 交互式管理界面
  showPluginManager?(registry: PluginRegistry): Promise<boolean>;
  showModelPicker?(registry: PluginRegistry): Promise<boolean>;
}
```

`DisplayPlugin` 在 `registry.onInit` 阶段可以通过 `setConfirmCallback` 和 `setOutputHandler` 将权限确认和输出流绑定到自定义 UI。

配置方式：

```yaml
display:
  plugin: my-display    # 展示层插件名
```

展示层插件注册在 `src/plugins/display/loader.ts`。

---

## 完整示例：带配置和钩子的插件

```typescript
import { NanoPlugin, PluginRegistry, ToolCall } from '#src/core/plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '#src/core/contract.js';

interface CounterConfig {
  maxCalls?: number;
}

export const counterPlugin: NanoPlugin = {
  name: 'counter',
  description: '记录工具调用次数，超过限制后拒绝',

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_call_count',
          description: '查看当前会话中的工具调用次数',
          parameters: { type: 'object', properties: {} },
          sideEffect: false,
        },
      },
    ];
  },

  async onInit(registry: PluginRegistry): Promise<void> {
    const config = registry.getPluginConfig('counter') as CounterConfig;
    // 注意：onInit 中不能直接给 this 赋值
    // 使用闭包变量代替（见下方工厂模式）
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    return { status: 'success', data: `当前工具调用计数需要闭包实现` };
  },

  onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
    // 实际使用时需通过闭包管理内部状态
    return toolCall;
  },
};
```

由于 `NanoPlugin` 是一个对象字面量，内部状态需要使用**闭包**管理：

```typescript
export function createCounterPlugin(config?: CounterConfig): NanoPlugin {
  const maxCalls = config?.maxCalls ?? 100;
  let callCount = 0;

  return {
    name: 'counter',
    description: '记录工具调用次数，超过限制后拒绝',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'get_call_count',
            description: '查看当前会话中的工具调用次数',
            parameters: { type: 'object', properties: {} },
            sideEffect: false,
          },
        },
      ];
    },

    async execute(_name: string, _args: any, _ctx: ToolContext): Promise<ToolResponse> {
      return { status: 'success', data: `已调用 ${callCount} 次` };
    },

    onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
      callCount++;
      if (callCount > maxCalls) {
        return null; // 拒绝
      }
      return toolCall;
    },
  };
}
```

### 工厂函数模式注册

在 `src/index.ts` 或入口文件注册：

```typescript
import { createCounterPlugin } from './plugins/tools/counter.js';

// 有配置时
const config = registry.getPluginConfig('counter');
await registry.register(createCounterPlugin(config));

// 无配置时，走 BUILTIN_LOADERS
// 在 src/core/plugin.ts 的 BUILTIN_LOADERS 添加：
// counter: async (s) => (await import('#src/plugins/tools/counter.js')).createCounterPlugin(s || {}),
```

---

## 与插件系统交互的其它接口

### AgentDisplay（窄接口）

`NanoCodeAgent` 不直接依赖完整的 `DisplayPlugin`，而是通过 `AgentDisplay` 窄接口交互。展示层通过 `DisplayManager.asAgentDisplay()` 适配。

### NanoCodeAgentOptions

```typescript
interface NanoCodeAgentOptions {
  registry: PluginRegistry;
  llmClient?: LLMClient;
  agentRole?: string;
  promptConfig?: SystemPromptConfig;
  name?: string;
  display?: AgentDisplay;
  abortController?: AbortController; // 外部注入的取消信号
}
```

### ModelEntry（用于 model-registry 插件）

```typescript
interface ModelEntry {
  provider?: 'openai' | 'anthropic';
  model: string;
  apiKey?: string;      // 支持 $ENV_VAR 语法
  baseURL?: string;     // 支持 $ENV_VAR 语法
  temperature?: number;
  maxTokens?: number;
  extraParams?: Record<string, unknown>; // 透传到 LLM API
}
```

---

## hooks 执行顺序

```
用户输入 → onBeforeAgentInput
     ↓ （未被拦截）
Agent.runTask()
     ↓
buildSystemPrompt()
     ↓
execSystemPrompt()    ← 多个插件链式执行
     ↓
execBeforeRequest()   ← 多个插件链式执行，修改消息列表
     ↓
LLM API 请求
（发送前调用 collectExtraParams() 收集各插件的 onExtraParams）
     ↓
LLM API 响应
     ↓
execAfterRequest()    ← 多个插件广播执行
     ↓
if (有工具调用):
  for each 工具:
    execBeforeToolCall() ← 任一返回 null 则拒绝
      ↓
    权限确认（sideEffect=true 且不在 allowlist 时）
      ↓
    registry.execute()
      ↓
    execAfterToolCall()  ← 多个插件链式执行
```

---

## 测试插件

利用 `PluginRegistry` 的单元测试模式：

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '#src/core/plugin.js';
import { createCounterPlugin } from '#src/plugins/tools/counter.js';

describe('counter 插件', () => {
  it('注册后 getAllSchemas 返回工具定义', async () => {
    const r = new PluginRegistry();
    await r.register(createCounterPlugin());

    assert.equal(r.getAllSchemas().length, 1);
    assert.equal(r.getAllSchemas()[0].function.name, 'get_call_count');
  });

  it('execute 返回调用次数', async () => {
    const r = new PluginRegistry();
    await r.register(createCounterPlugin({ maxCalls: 5 }));

    const result = await r.execute('get_call_count', {});
    assert.equal(result.status, 'success');
  });

  it('超过上限后拒绝工具调用', async () => {
    const r = new PluginRegistry();
    await r.register(createCounterPlugin({ maxCalls: 0 }));

    // onBeforeToolCall 返回 null 表示拒绝
    assert.equal(r.execBeforeToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: '{}' },
    }), null);
  });
});
```

---

## Agent Profile（角色配置）

通过 `--profile <name>` 直接启动为特定角色。Profile 可以配置角色身份和插件设置。

```json
// ~/.nano-code/profiles/treehole.json
{
  "agent": {
    "role": "一个善解人意的树洞，温柔地倾听用户的心声",
    "greeting": "你好，我是树洞。你可以放心地说任何事情。"
  },
  "plugins": {
    "memory": { "enabled": true, "settings": { "namespace": "treehole" } },
    "command": { "enabled": false }
  }
}
```

Profile 查找优先级：`.nano-code/profiles/<name>.yaml`（项目）> `~/.nano-code/profiles/<name>.yaml`（全局）。

---

## 最佳实践

1. **工具名用 snake_case** —— 与 OpenAI 工具命名风格一致
2. **description 要精确** —— 直接决定 LLM 是否在正确场景调用
3. **`sideEffect` 要正确标记** —— 只读工具标记为 `false` 以获得并行执行和跳过确认
4. **data 返回结构化文本** —— AI 更容易理解，不要返回二进制
5. **善用 `newMessages`** —— 用于 inline skill 展开，以 user 消息形式注入额外上下文
6. **工厂函数模式** —— 有内部状态或配置参数的插件应使用工厂函数，而非导出单例
7. **Store 通信** —— 插件间需要共享运行时信息时使用 `registry.store`，而非全局变量
8. **钩子里不要修改插件外部状态** —— 只读观测是安全的，副作用要谨慎
9. **`onInit` 失败不要阻塞注册** —— 框架会捕获异常，插件仍然可用
10. **避免在 `execute` 外执行耗时操作** —— 钩子应快速返回

---

## Source Tree 参考

```
src/
├── core/
│   ├── plugin.ts        # NanoPlugin 接口 + PluginRegistry + BUILTIN_LOADERS
│   ├── contract.ts      # ToolDefinition, ToolResponse, ToolContext 等
│   ├── agent.ts         # NanoCodeAgent — 主 ReAct 循环
│   ├── llm.ts           # LLMClient — 流式 API + ModelEntry 类型
│   ├── prompt.ts        # 系统提示词组装
│   ├── config.ts        # 配置加载 + 合并 + 校验
│   ├── store.ts         # IStore 接口 + InMemoryStore
│   ├── store-keys.ts    # Store key 常量（所有跨插件协议在此定义）
│   ├── session.ts       # 会话持久化
│   ├── retry.ts         # 重试工具函数
│   └── logger.ts        # 日志管理器
├── display.ts           # DisplayPlugin 接口 + DisplayManager
├── plugins/
│   ├── tools/           # 内置工具插件（fs, command, memory, search, web）
│   ├── mcp/             # MCP 适配器（stdio + HTTP 传输）
│   ├── token-budget/    # Token 追踪和预算管理
│   ├── model-registry/  # 模型注册表
│   ├── coordinator/     # 多 Agent 协调
│   ├── skills/          # 技能系统
│   ├── commands/        # 斜杠命令系统
│   ├── display/         # 展示层（repl, cli, ink）
│   ├── compact/         # 对话压缩
│   ├── npm-loader.ts    # npm 包加载器
│   └── task-plan/       # 任务规划
└── index.ts             # 入口：CLI 解析 + 插件初始化 + 主循环
```
