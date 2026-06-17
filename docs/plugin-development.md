# nano-code 插件开发指南

## 概述

nano-code 采用极简核心 + 插件驱动的架构。所有工具能力都由插件提供。Core 只负责 Agent 循环、LLM 通信和插件编排，不内置任何业务工具。

插件（Plugin）是一个实现了 `NanoPlugin` 接口的模块，可以：

- **提供工具**（`getTools` / `execute`）——让 AI 可以调用你定义的操作
- **注入行为**（`onSystemPrompt`）——修改智能体的系统提示词，或参与动态提示词生成
- **观测和控制**（`onBeforeRequest` / `onAfterRequest` / `onBeforeToolCall` / `onAfterToolCall`）——拦截消息、追踪用量、拒绝调用

插件注册后，系统提示词的 `buildRoleLine` 会自动根据实际注册的工具列表生成工具描述（而非硬编码"查看目录、读取文件"），使插件可以适配任意角色。

---

## 插件接口

```typescript
interface NanoPlugin {
  // 基本信息
  name: string;              // 唯一标识，也用作配置命名空间
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
  onAfterRequest?(response: LLMResponse): void;
  onBeforeToolCall?(toolCall: ToolCall): ToolCall | null;
  onAfterToolCall?(result: ToolResponse): ToolResponse;
}
```

### 关键类型

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;             // 工具名，必须唯一
    description: string;      // 描述，LLM 据此决定是否调用
    parameters: Record<string, any>;  // JSON Schema 格式参数定义
  };
}

interface ToolResponse {
  status: 'success' | 'rejected_by_user' | 'error';
  data?: string;     // 成功时返回数据
  message?: string;  // 失败/被拒时返回消息
}

interface ToolContext {
  skipPermission: boolean;   // 是否跳过用户确认
  cwd: string;               // 当前工作目录
  defaultTimeout: number;    // 默认超时（毫秒）
}
```

---

## 快速开始：写一个"时间工具"插件

在 `src/plugins/tools/` 下创建 `datetime.ts`：

```typescript
import { NanoPlugin } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';

export const datetimePlugin: NanoPlugin = {
  name: 'datetime',
  description: '获取当前日期和时间',

  getTools(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: '获取当前的日期和时间信息，包括时区。当用户询问"现在几点"时使用。',
          parameters: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                description: '时间格式，可选：iso / full / date / time',
                enum: ['iso', 'full', 'date', 'time'],
              },
            },
          },
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

    const data = {
      iso: now.toISOString(),
      full: now.toString(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
    }[format] || now.toISOString();

    return {
      status: 'success',
      data: `当前时间: ${data}`,
    };
  },
};
```

然后在 `src/index.ts` 中加入内置插件注册器：

```typescript
// src/index.ts 的 BUILTIN_PLUGINS 表中添加一行
const BUILTIN_PLUGINS: Record<string, () => Promise<any>> = {
  fs: () => import('./plugins/tools/fs.js').then(m => m.fsPlugin),
  command: () => import('./plugins/tools/command.js').then(m => m.commandPlugin),
  datetime: () => import('./plugins/tools/datetime.js').then(m => m.datetimePlugin),  // 新增
};
```

这样用户在 `.nano-code.json` 中配置 `"datetime": {}` 即可启用，无需手动注册。插件默认不加载，只有在配置中显式声明的才会被注册。

---

## 详细指南

### 1. 工具定义（getTools）

`getTools()` 返回的 `ToolDefinition` 数组定义了 AI 可以调用的工具。每个工具需要：

- **`name`** —— 工具名，全局唯一，AI 通过名字调用
- **`description`** —— 描述该工具**何时、为何**被调用。措辞直接影响 AI 的判断准确度
- **`parameters`** —— [JSON Schema](https://json-schema.org/) 格式的参数定义

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
            query: {
              type: 'string',
              description: '搜索关键词',
            },
            max_results: {
              type: 'number',
              description: '最大返回条数（默认 5）',
              default: 5,
            },
          },
          required: ['query'],
        },
      },
    },
  ];
}
```

### 2. 工具执行（execute）

当 AI 决定调用工具时，`execute(name, args, ctx)` 会被调用：

```typescript
async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
  // name:   工具名（由 getTools 定义）
  // args:   AI 填充的参数对象
  // ctx:    执行上下文

  // 成功返回：
  return { status: 'success', data: '执行结果文本' };

  // 失败返回：
  return { status: 'error', message: '错误描述' };
}
```

`data` 字段的内容会作为工具执行结果喂给 AI，所以返回信息应简洁、结构化、便于 AI 理解。

### 3. 生命周期钩子

#### onInit

插件注册时调用。适合做初始化工作（创建临时目录、启动进程、连接数据库）：

```typescript
async onInit(registry: PluginRegistry): Promise<void> {
  const config = registry.getPluginConfig(this.name);
  await connectToDatabase(config.connectionString);
}
```

**注意：** `onInit` 抛出的异常会被 `PluginRegistry` 捕获并打印警告，**不会**阻止插件注册。工具仍然可用，但初始化失败可能会影响后续执行。

#### onDestroy

插件注销时调用。适合做清理工作（关闭连接、删除临时文件）：

```typescript
async onDestroy(): Promise<void> {
  await closeDatabaseConnection();
  await cleanupTempFiles();
}
```

### 4. 通用钩子

钩子让插件可以观测和干预 Agent 的每个环节。

#### onSystemPrompt —— 扩展系统提示词

```typescript
onSystemPrompt(prompt: string): string {
  return `${prompt}\n- 你是编程助手，优先使用 TypeScript 回答代码问题。`;
}
```

多个插件的 `onSystemPrompt` 会按注册顺序依次执行，前一个的输出作为后一个的输入。

#### onBeforeRequest —— 修改发给 LLM 的消息

```typescript
onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
  // 统计历史消息的 token 数
  const totalContent = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  if (totalContent > 10000) {
    // 压缩过长的历史（token budget 插件的核心逻辑）
    return summarizeMessages(messages);
  }
  return messages;
}
```

#### onAfterRequest —— 观察 LLM 响应

```typescript
onAfterRequest(response: LLMResponse): void {
  // 记录 token 用量（token budget 插件使用此钩子）
  tokenTracker.record(response.text, response.toolCalls);
}
```

#### onBeforeToolCall —— 拦截/拒绝工具调用

返回 `null` 可拒绝此次调用。常用于预算控制、安全检查：

```typescript
onBeforeToolCall(toolCall: ToolCall): ToolCall | null {
  if (toolCall.function.name === 'run_bash_command') {
    const args = JSON.parse(toolCall.function.arguments);
    if (isDangerous(args.command)) {
      console.warn(`[security] 拦截危险命令: ${args.command}`);
      return null;  // 拒绝
    }
  }
  return toolCall;  // 放行
}
```

**注意：** `onBeforeToolCall` 的短路机制——任何一个插件返回 `null`，后续插件不再执行，调用被拒绝。

#### onAfterToolCall —— 观察/修改执行结果

```typescript
onAfterToolCall(result: ToolResponse): ToolResponse {
  // 记录操作到日志或记忆系统
  memory.record(extractKeyInfo(result));
  return result;  // 也可以修改 result
}
```

多个插件的 `onAfterToolCall` 会按注册顺序依次执行，前一个的输出作为后一个的输入。

### 5. 配置文件访问

插件可以有自己的配置，存放在 `.nano-code.json` 中：

```json
{
  "plugins": {
    "datetime": {
      "settings": {
        "timezone": "Asia/Shanghai",
        "format24h": true
      }
    }
  }
}
```

在插件内部通过 `onInit` 读取：

```typescript
async onInit(registry: PluginRegistry): Promise<void> {
  const config = registry.getPluginConfig('datetime');
  // config = { timezone: "Asia/Shanghai", format24h: true }
}
```

**配置隔离：** 每个插件只能读取自己命名空间的配置，不能读取其他插件或 Core 的配置。

---

## 完整示例：带配置和钩子的插件

```typescript
import { NanoPlugin, PluginRegistry } from '../../plugin.js';
import { ToolDefinition, ToolResponse, ToolContext } from '../../contract.js';

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
        },
      },
    ];
  },

  async onInit(registry: PluginRegistry): Promise<void> {
    const config = registry.getPluginConfig('counter') as CounterConfig;
    this._maxCalls = config.maxCalls ?? 100;
    this._callCount = 0;
  },

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResponse> {
    return { status: 'success', data: `已调用 ${this._callCount} 次` };
  },

  onBeforeToolCall(toolCall): ToolCall | null {
    this._callCount++;
    if (this._callCount > this._maxCalls) {
      console.warn(`[counter] 超过调用上限 (${this._maxCalls})，拒绝: ${toolCall.function.name}`);
      return null;
    }
    return toolCall;
  },
};
```

---

## 测试插件

利用 `PluginRegistry` 的单元测试模式：

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PluginRegistry } from '../src/plugin.js';
import { datetimePlugin } from '../src/plugins/tools/datetime.js';

describe('datetime 插件', () => {
  it('返回当前时间', async () => {
    const r = new PluginRegistry();
    await r.register(datetimePlugin);

    const result = JSON.parse(await r.execute('get_current_time', {}));
    assert.equal(result.status, 'success');
    assert.match(result.data, /202\d/);  // 包含年份
  });

  it('支持 format 参数', async () => {
    const r = new PluginRegistry();
    await r.register(datetimePlugin);

    const result = JSON.parse(await r.execute('get_current_time', { format: 'date' }));
    assert.equal(result.status, 'success');
  });

  it('注册后 getAllSchemas 返回工具定义', async () => {
    const r = new PluginRegistry();
    await r.register(datetimePlugin);
    assert.equal(r.getAllSchemas().length, 1);
    assert.equal(r.getAllSchemas()[0].function.name, 'get_current_time');
  });
});
```

---

## 插件分类

| 类型 | 注册方式 | 特点 | 示例 |
|------|---------|------|------|
| **内置插件** | `"name": {}` in config | 随 nano-code 发布，纯 in-process | `fs.ts`, `command.ts`, `memory.ts` |
| **工厂插件** | `"name": {}` in config + 单独注册 | 带配置参数的内置插件 | `token-budget.ts`, `memory.ts` |
| **MCP 适配** | `"name": { "type": "mcp" }` in config | 自动包装外部 MCP Server | 数据库、浏览器等 |

### 工厂函数模式

部分插件需要接收配置参数，不适合导出单例。此时用工厂函数：

```typescript
export function createMemoryPlugin(config?: MemoryPluginConfig): NanoPlugin {
  const cfg = {
    namespace: config?.namespace ?? 'default',
    maxMemories: config?.maxMemories ?? 200,
    ...
  };
  return { name: 'memory', getTools, execute, ... };
}
```

在 `src/index.ts` 中单独注册：

```typescript
if (config.plugins['memory']) {
  const memoryConfig = config.plugins['memory'].settings || {};
  await registry.register(createMemoryPlugin(memoryConfig));
}
```

## 启动特定角色（Agent Profile）

nano-code 支持通过 `--profile <name>` 直接启动为特定角色，绕过主 agent 转发。Profile 可以配置角色身份、插件启停和插件设置。

在 `~/.nano-code/profiles/<name>.json` 或 `.nano-code/profiles/<name>.json` 中定义：

```json
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

启动：`nano-code --profile treehole`

Profile 也支持直接传入文件路径：`nano-code --profile ./my-role.json`。

详细引导请参考 [`plugin-guides/GUIDE-TEMPLATE.md`](../plugin-guides/GUIDE-TEMPLATE.md)（面向 AI 编程工具的引导模板）。

---

## 最佳实践

1. **工具名用 snake_case** —— 与 OpenAI 工具命名风格一致
2. **description 要精确** —— 直接决定 LLM 是否在正确场景调用
3. **data 返回结构化文本** —— AI 更容易理解，不要返回二进制
4. **善用 `ctx.skipPermission`** —— 用户开启免确认模式时跳过提示
5. **钩子里不要修改插件外部状态** —— 只读观测是可以的，副作用要小心
6. **`onInit` 失败不要阻塞注册** —— 框架会捕获异常，插件仍然可用
7. **避免在 `execute` 外执行耗时操作** —— 钩子应快速返回
