# Display Plugin 开发引导

Display Plugin 是 nano-code 的展示层插件。独立于 PluginRegistry，不参与 LLM 上下文。

## 接口定义

源文件：`src/display.ts`

```typescript
interface StartConfig {
  greeting: string;        // 启动提示语
  agentName: string;       // 当前 agent 名（主 agent 为 "main"）
  profileName?: string;    // 当前角色配置名
  hasTools: boolean;       // 是否有工具注册
}

interface DisplayPlugin {
  name: string;

  // ── 生命周期 ──
  onStart?(config: StartConfig): void;
  onStop?(message: string): void;

  // ── 输入 ──
  prompt?(): Promise<string | null>;   // null = 无输入

  // ── 输入回显 ──
  onUserInput?(input: string, sourcePlugin: string): void;

  // ── 输出 ──
  onStatus?(message: string): void;
  onStreamChunk?(chunk: string): void;
  onToolCall?(message: string): void;
  onToolResult?(message: string): void;
  onError?(error: string): void;
  onDebug?(data: string): void;
}
```

## 调用时序

```
启动        onStart(config)
            ↓ 循环 ──────────────────────
输入        prompt()             → 用户输入
输入回显    onUserInput(input, sourcePlugin)
            ↓
LLM 请求    onStatus("? 正在思考...")
            onStreamChunk(chunk)  ← 逐块流式输出
            ↓
工具调用    onToolCall("# AI 申请调用本地工具: [tool]")
            onToolResult("[OK] 工具执行完毕")
            ↓ 回到"输入" ───────────────
退出        onStop("bye")
```

## 消息格式约定

当前 display 层传递的都是**已格式化字符串**（agent.ts 中用 `this.p()` 添加了前缀）。格式如下：

### onStatus

| 来源 | 格式 |
|------|------|
| 主 agent | `? 正在思考并请求大模型...` |
| 子 agent | `[dba] ? 正在思考并请求大模型...` |
| 调试 | `>> [DEBUG] 发送给大模型的完整 Messages 历史:` |
| 会话恢复 | `↻ 已恢复上次会话 (5 条消息...)` |

### onToolCall

| 格式 |
|------|
| `# AI 申请调用本地工具: [tool_name]` |
| `[dba] # AI 申请调用本地工具: [tool_name]` |

### onToolResult

| 状态 | 格式 |
|------|------|
| 成功 | `[OK] [成功] 工具执行完毕。` |
| 失败 | `X [错误] 工具执行失败: ...` |
| 拒绝 | `[!] [拦截] 您拒绝了此操作...` |
| 拦截 | `[!] [拦截] 插件拒绝了工具调用: [tool]` |

### onStreamChunk

- 主 agent：逐块原始 LLM 文本输出（已过滤 think 标签）
- 子 agent：整段文本，每行带 `[name]` 前缀，一次性写出

### onError / onDebug

- `onError`：`X 顶层循环捕获到未处理的致命异常: Error: ...`
- `onDebug`：JSON 序列化的调试数据或错误堆栈

## 输入回显策略

当 `prompt()` 返回非 null 后，DisplayManager 向**所有** display 插件广播 `onUserInput(input, sourcePlugin)`。每个插件自行决定回显：

```typescript
// repl 实现：自身来源不回显，外部来源回显前 10 字
onUserInput(input: string, sourcePlugin: string): void {
  if (sourcePlugin === 'repl') return;
  const preview = input.length > 10 ? input.slice(0, 10) + '…' : input;
  console.log(`  [来自 ${sourcePlugin}] >> ${preview}`);
}
```

## 多插件交互

- **输入**：`prompt()` 轮询所有已注册插件，取第一个非空返回值
- **输出**：`onStatus / onStreamChunk / onToolCall / onToolResult / onError / onDebug` **广播**给所有插件
- **注册**：`displayManager.addPlugin(myPlugin)` 按添加顺序轮询

举例：同时注册 repl + websocket 两个 display 插件，用户从 repl 输入，websocket 收到所有输出广播和输入回显。

## 出口规范

Display Plugin 通过 `~/.nano-code/presentations/` 目录或路径引用加载，**不是通过 plugin-cli 管理**。

```yaml
# nano-code 配置
display:
  plugin: my-plugin    # 从 ~/.nano-code/presentations/my-plugin.js 加载
  # 或
  plugin: /path/to/custom.js  # 绝对路径
```

插件文件需要 `export default` 一个 `DisplayPlugin` 对象：

```typescript
// ~/.nano-code/presentations/minimal.ts
import { DisplayPlugin } from 'nano-code/display';

const minimalDisplay: DisplayPlugin = {
  name: 'minimal',
  prompt: async () => { /* readline input */ },
  onStreamChunk(chunk) { process.stdout.write(chunk); },
  onStatus(msg) { console.log(msg); },
  // ...
};

export default minimalDisplay;
```

## 注意事项

1. 所有输出钩子都是同步的
2. `prompt()` 是异步的，支持基于事件循环的输入等待
3. 插件内不要抛异常——DisplayManager 不捕获插件错误
4. 字符串前缀（`[dba]`）已经由 agent 格式化，插件不需要处理前缀逻辑
5. `onStreamChunk` 接收的是纯文本流，不含格式标记

## 当前限制

1. **结构化数据缺失**：`onToolCall` 和 `onToolResult` 收到的已经是格式化字符串，而不是 `{ toolName, status, args }` 等结构化数据。如果插件需要自定义渲染工具调用，目前只能在字符串层面做解析。
2. **一次性分块**：子 agent 的流式输出是整段缓冲后发出的（`onStreamChunk` 只调用一次），不支持逐 token 渲染。
3. **无插件级错误隔离**：DisplayManager 的 `for (const p of this.plugins) p.onXxx?.()` 没有 try-catch，单个插件抛异常会阻断后续插件。

