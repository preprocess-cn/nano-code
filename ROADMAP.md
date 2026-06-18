# 开发路线图

## P0 — 核心可靠（当前）

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | `--list-plugins` | 列出已注册插件及其工具 |
| ✅ | 配置测试覆盖 | config.ts 合并逻辑测试 |
| ✅ | Agent 测试覆盖 | getHistory / loadHistory 测试 |
| ✅ | 会话持久化 | `-c`/`--continue` 接续上次对话，`finally` 块自动保存 |

剩余：端到端的会话接续集成测试。

## P1 — 日常体验

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 1 | **npm 插件加载器** | ✅ | 实现 `type: 'npm'`，支持 `import()` 加载 npm 包为 NanoPlugin |
| 2 | **`plugin` CLI 子命令** | ✅ | `nano-code plugin install/list/enable/disable`，插件生命周期管理 |
| 3 | **配置校验** | ✅ | 载入 config.json 时做 schema 校验 |
| 4 | **配置 merge 精简** | ✅ | 泛型 mergeTypedFields |
| 5 | **agent runTask 职责拆分** | ✅ | think-tag 过滤/流处理/工具调度拆出独立方法 |

## P2 — 能力增强

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 6 | **会话上下文修剪** | ~2d | token-budget 之上做智能摘要/裁剪 |
| 7 | **LLM 失败重试** | ✅ | 3 次指数退避（1s, 2s, 4s） |
| 8 | **多轮摘要记忆** | ~3d | 超出窗口时自动压缩历史 |
| 9 | **工具型子 agent 系统** | ✅ | `~/.nano-code/agents/*.yaml` 自动注册为 `agent-<name>` 工具，独立 PluginRegistry + messageHistory |
| 10 | **角色模式 & 斜杠命令** | ~3d | `profiles/` 目录可用于 `--profile` 切换角色。斜杠命令 `/treehole` 等运行时切换未实现 |
| 11 | **Agent Plugin 架构** | ✅ | 子 agent 持有独立 `NanoCodeAgent` 实例 + 独立插件集合，通过 agent 名称身份识别 |
| 12 | **Profile Plugin 架构** | ✅ | 角色型 profile 注册机制（文件扫描），`--profile` 加载，profile 维护独立工具配置 |
| 13 | **展示层插件系统** | ✅ | `DisplayPlugin` 接口 + `DisplayManager` 多插件管理器，结构化事件，`display.plugin` 配置 |

## P3 — 生态准备

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 14 | **CI/CD** | ~3h | GitHub Actions + 自动测试 |
| 15 | **发布准备** | ~4h | package.json 补全、README 更新、npm publish |
| 16 | **插件权限系统** | ~3d | npm 插件的安全沙箱 + 权限声明机制 |
| 17 | **插件热加载** | ~2d | 运行时开关插件无需重启 |
| 18 | **更多内置插件** | ~2d | 按需提供数据库、HTTP 请求等常用插件 |

## 展示层插件化（未来方向）

当前交互层（TUI/REPL）硬编码在 `index.ts` 中。可抽象为 `PresentationPlugin` 接口：

```typescript
interface PresentationPlugin {
  start?(config: { greeting: string; agentName: string }): Promise<void>;
  prompt?(): Promise<string | null>;      // 获取用户输入
  showStream?(chunk: string): void;       // 流式输出
  showTool?(toolName: string): void;      // 工具调用
  showStatus?(msg: string): void;         // 状态信息
  end?(message: string): void;
}
```

场景：
- **默认 REPL**：`@clack/prompts` + console 输出（当前实现）
- **极简模式**：`readline` 裸输入
- **子 agent 模式**：带 `[name]` 前缀的输出（已内建）
- **CLI one-shot 模式**：stdin/stdout 管道
- **Web UI**：对接到 HTTP/WebSocket

每个 agent 或 profile 可在定义中指定自己的展示插件。

## Agent 架构

### 两个目录的分界

```
~/.nano-code/
├── profiles/             ← 角色型 profile，交互式，仅 --profile 进入
│   └── treehole.json     「倾听倾诉」→ 沉浸式角色
└── agents/               ← 工具型 agent，暴露为 tool 给主 agent
    └── dba.yaml          「分析慢查询」→ 有明确输入输出
```

**判断标准：** 该角色做的事能否作为一个独立结果返回？

- **能** → `agents/` → 注册为主 registry 的一个 tool，子 agent 用独立 `NanoCodeAgent` 实例 + 独立插件集合执行 sub-loop，返回结果给主 agent
- **不能** → `profiles/` → 仅通过 `--profile` 进入，不暴露为 tool

### Agent 身份系统

每个 `NanoCodeAgent` 实例有 `name`（默认 `'main'`），`PluginRegistry` 持有当前 agent 名称。输出按 agent 名称添加前缀：

- 主 agent：无前缀
- 子 agent：`[dba]` 前缀

### 三层安全性（已实现）

1. **递归防护：** 子 agent 的 PluginRegistry 只注册 `def.plugins` 中定义的插件，不注册 agent 工具
2. **非交互执行：** 子 agent 内部 tool calls 自动确认（`skipPermission: true`）
3. **上下文隔离：** 每个子 agent 持有独立 `messageHistory`，主 agent 只看到结果

### 与 MCP 的关系

MCP 和 agent 工具都是"主 agent 委托能力给外部"，区别在：
- MCP 是外部进程，通过 JSON-RPC 通信，协议固定
- Agent 工具是内部 `NanoCodeAgent` 实例，共享进程，灵活度高

两者互补：agent 工具适合轻量、同进程的委派；MCP 适合重量、异构、独立部署的服务。

## 已实现功能

- ReAct Agent 循环 + 流式 LLM 通信
- 插件注册中心（PluginRegistry）：注册、注销、工具路由、钩子链
- 内置插件：fs（文件读写 + patch）、command（bash 执行 + 安全黑名单）、**memory（记忆存储/检索）**
- MCP 集成：通过 stdio/HTTP JSON-RPC 加载任意 MCP Server
- Token-budget 插件：会话/请求级别 token 用量跟踪与限制，使用 API 精确 token 统计
- 无工具时自动降级为纯对话模式
- agent 角色和启动提示可配置化
- **Agent Profile 系统**：通过 `--profile <name>` 直接进入特定角色模式，支持三层配置覆盖
- **动态系统提示词**：根据实际注册的工具列表生成工具描述，适配任意角色
- **插件引导文件系统（Guides）**：分阶段 markdown 引导文件，让 AI 编程工具按步骤创建插件
- **YAML 全局配置系统**：`~/.nano-code/config.yaml`，支持系统插件白名单、环境变量、提示词模板
- **系统插件白名单**：白名单内插件 CLI 不可操作，仅通过配置文件管理
- **`plugin` CLI 子命令**：`install`（npm/git/本地路径）、`list`、`enable`、`disable`
- **npm 插件加载器**：通过 `type: "npm"` 加载 npm 包为 NanoPlugin
- **Agent 身份系统**：`NanoCodeAgent` + `PluginRegistry` 均持有 agent name，输出按名带前缀
- **Agent 定义加载器**：自动扫描 `~/.nano-code/agents/*.yaml`，校验必填字段
- **子 agent 工具系统**：agent 定义为 tool 注册，调用时创建独立 `NanoCodeAgent` 实例独立执行
- **输出分层**：子 agent 输出带 `[name]` 前缀，主 agent 无前缀
- **展示层插件系统**：`DisplayPlugin` 接口 + `DisplayManager` 多插件管理器，结构化事件传递，`display.plugin` 配置加载
- **展示层插件引导**：`plugin-guides/display-plugin.md`，面向 AI 编程工具的开发文档
