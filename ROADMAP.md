# 开发路线图

## P0 — 核心可靠

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | `--list-plugins` | 列出已注册插件及其工具 |
| ✅ | 配置测试覆盖 | config.ts 合并逻辑测试 |
| ✅ | Agent 测试覆盖 | getHistory / loadHistory 测试 |
| ✅ | 会话持久化 | `-c`/`--continue` 接续上次对话，`finally` 块自动保存 |
| ✅ | **核心层解耦** | Plan mode 注入从 `agent.ts` 核心循环迁至 `task-plan` 插件 `onBeforeRequest` 钩子；Display 初始化从 `display.ts` 提取到插件层 `init.ts`，核心层不再依赖具体展示实现 |
| ✅ | **文件结构重组** | `agent-loader.ts`（`coordinator/` → `core/`）、`config-writer.ts`（`mcp/` → `core/mcp-config.ts`）；`ContextAnalysis` 类型从 plugin 的 `analyzer.ts` 提升到 `core/contract.ts`，消除类型泄漏 |
| ✅ | **全局状态栏 + 通知管理** | Ink 底栏 `StatusBar` 组件：左侧 `KEY: VALUE` 持久状态（mode 特殊渲染 `● PLAN`）、右侧通知消息循环展示；`DisplayPlugin.setStatusBar`/`onNotify` 接口；可选 `notify-manager` 后端插件（队列管理、轮询调度、2s 间隔）；REPL `setStatusBar` mode 响应 |
| ✅ | **核心层瘦身** | 6 个基础设施文件从 `src/core/` 迁出：`version.ts`/`tool-name.ts`/`retry.ts`/`token-counter.ts`/`logger.ts` → `src/utils/`，`session.ts` → `src/bootstrap/`；核心层文件从 15 降至 9 个 |
| ✅ | **引导插件 + 系统提示词分段** | Guidance 插件：前置 6 段 Claude Code 风格行为约束（`# System`/`# Doing tasks`/`# Executing actions with care`/`# Using your tools`/`# Tone and style`/`# Output efficiency`），`onBeforeRequest` 注入三级 AGENT.md 上下文，可分段开关；修复 `/context` 命令缺失 config 的问题；修复 Ink 代码块多行渲染 |

## P1 — 日常体验

| # | 功能 | 说明 |
|---|------|------|
| ✅ | npm 插件加载器 | `import()` 加载 npm 包为 NanoPlugin |
| ✅ | `plugin` CLI 子命令 | install/list/enable/disable，插件生命周期管理 |
| ✅ | 配置校验 | config.json 载入时 schema 校验 |
| ✅ | 配置 merge 精简 | 泛型 mergeTypedFields |
| ✅ | agent runTask 职责拆分 | think-tag 过滤/流处理/工具调度拆出独立方法 |

## P2 — 能力增强

| # | 功能 | 说明 |
|---|------|------|
| ✅ | LLM 失败重试 | 3 次指数退避（1s, 2s, 4s） |
| ✅ | 工具型子 agent 系统 | `~/.nano-code/agents/*.yaml` 自动注册为 `agent-<name>` 工具 |
| ✅ | Agent Plugin 架构 | 子 agent 持有独立 `NanoCodeAgent` + 独立插件集合 |
| ✅ | Profile Plugin 架构 | 角色型 profile 注册机制，`--profile` 加载 |
| ✅ | 展示层插件系统 | `DisplayPlugin` 接口 + `DisplayManager` 多插件管理器 |
| ✅ | 插件间共享状态（Store） | `IStore` 接口 + 默认 `InMemoryStore`，可替换实现 |
| ✅ | 额外参数注入（extraParams） | `onExtraParams` 钩子透传 LLM API 请求参数 |
| ✅ | usage 剥离 | LLMResponse 不再含 usage，改为 `rawMeta` 回调由插件自行解析 |
| ✅ | 插件生命周期事件 | `onAgentTurnStart/End`、`onStateSnapshot` 等 DisplayPlugin 新事件 |
| ✅ | Agent 构造函数精简 | 移除 `isSubAgent`/`showThink` 参数，改为 display 驱动 |

## P3 — 生态准备

| # | 功能 | 说明 |
|---|------|------|
| ✅ | CI/CD | GitHub Actions + 自动测试 |
| ☐ | 发布准备 | package.json 补全、README 更新、npm publish |
| ✅ | **MCP 自动发现** | 启动时自动扫描 `~/.nano-code/.mcp.json` + `$CWD/.mcp.json` + `~/.claude/.mcp.json`（只读兼容），零配置加载已安装的 MCP server |
| ✅ | **`plugin mcp-add`** | 对标 `claude mcp add`，同时写入 `.mcp.json` + `config.plugins` 声明，支持 `--scope user` |
| ✅ | **`plugin autoscan`** | 扫描 `~/.claude/.mcp.json` 导入到 nano-code 自有配置并补全 `config.plugins` 声明 |
| ✅ | **`plugin uninstall`** | 卸载插件，从所有域（项目/全局）的 `config.plugins` + `.mcp.json` + `presentations/` 中移除，支持 `--scope` |
| ✅ | **`plugin install` 检测 DisplayPlugin** | 安装时自动检测包中的 DisplayPlugin，写入 `~/.nano-code/presentations/`（绝对路径 re-export），全局配置注册为 `type: display`（默认 disabled），`plugin list` 显示 `[display]` 标签 |
| ✅ | **轻量权限系统** | PluginRegistry allowlist + agent 层 permission gate + fs/command 加固，Ink 权限弹窗三选项（批准/始终允许/拒绝），`/permissions` 查看/管理已允许工具 |
| ✅ | **交互式 `/plugin` 命令** | 会话中通过 `/plugin list/enable/disable/manage` 管理插件；Ink 下进入全屏交互式插件管理器，`↑↓`/`Enter`/`/` 搜索/Esc 退出；REPL 回退文本列表 |
| ✅ | **Model Registry 插件** | 声明多个 LLM 模型，`/model` 命令 + Ink 交互式选择器 + `--model` CLI 启动切换，`$ENV_VAR` 加密钥隐藏 |
| ☐ | 插件热加载 | 运行时开关插件无需重启 |
| ✅ | 上下文裁剪与压缩 | `/compact` 内建命令 + 基于 LLM 摘要的智能压缩，保留最近对话、移植 Claude Code 9 段总结模板 |
| ✅ | 后台 agent 执行 | `agent-<name>({ query, run_in_background: true })` 异步执行，主 agent 立即返回 `taskId`，完成后自动注入结果；可同时启动多个后台 agent |
| ✅ | Agent 任务状态查询 | `agent_task_status({ task_id? })` 工具查询单个或全部后台任务状态 |
| ✅ | Agent 间通信 | `send_message({ to, summary, message })` 工具，基于 `MessageBus` 单例的信箱模式，支持 agent 名称或 taskId 寻址 |
| ✅ | Agent Coordinator 协调层 | 统一管理所有 agent 工具的注册、后台执行生命周期和 agent 间消息传递，替代逐一手动注册 |
| ✅ | Ink 后台任务指示器 | `BackgroundTaskBar` 底栏组件，实时展示运行/完成/失败状态，5 秒自动清理 |
| ✅ | 后台任务展示层事件 | `BackgroundTaskEvent` + `onBackgroundTask` 回调，REPL 和 Ink 双实现 |
| ✅ | **Ink 上下文可视化** | `InkApp.tsx` 内联 `ContextVis` 组件渲染色块网格，数据源为 `analyzer.ts` 的 8 维度分析 |
| ✅ | **工具级自定义超时** | `ToolDefinition.function.timeout` 字段，按工具设定超时时间；`Infinity` 永不超时（`ask_user_question`），未指定沿用全局默认 |
| ✅ | **工具 sideEffect 修正** | `task_create`/`task_update`/`task_stop`/`save_memory`/`skill`/`exit_plan_mode` 改为 `sideEffect: false`，内建读操作无需审批 |
| ✅ | 多轮摘要记忆 | 自动压缩默认启用（`autoCompactEnabled: true`），触发策略改为基于当前消息大小 + slide window 多次压缩，压缩前全量备份至 `.nano-code-session.pre-compact.json` |
| ✅ | 角色模式 & 斜杠命令 | profiles/ 通过 `--profile` 启动时加载，主 agent 可通过斜杠 `/` 切换 agent；profile 运行时切换暂不支持 |
| ✅ | 内置 Skill 系统 | 13 个对齐 Claude Code 的内置技能：simplify/verify/batch/debug/lorem-ipsum/update-config/remember/stuck/skillify/keybindings/review/commit/commit-pr |
| ☐ | ToolUseContext | 工具执行的共享运行时上下文（模型覆盖、effort、权限绑定等），贯穿 ReAct 循环 |
| ☐ | contextModifier | 工具可通过 ToolResponse 返回上下文修改器，作用于后续工具调用的执行环境 |
| ✅ | Skill 系统 | 13 个内置 TypeScript 技能（bundled），skills_list / skill_view / skill 工具，inline（newMessages 注入）+ fork（子 agent）双模式，skills 配置禁用开关 |
| ✅ | **InteractiveHandler** | PluginRegistry 原生 `registerInteractiveHandler`/`getInteractiveHandler` 替代 store callback，工具插件与 display 通过 registry 桥接，无 handler 自动降级为文本 |

## P0 — 搜索与审查

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | Glob/Grep 搜索工具 | 文件名模式匹配 + 文件内容搜索，替代暴力递归遍历 |
| ✅ | Keybinding 系统 | `useKeybinding`/`useKeybindings` hooks，支持修饰键和命名键的匹配 |
| ✅ | Ctrl+C 取消执行 | 执行中 Ctrl+C 中断 LLM 流 + 停止 agent，返回提示状态 |
| ✅ | LLM AbortSignal | `sendSystemMessage` 支持 `AbortSignal`，立即中断 HTTP 流避免浪费 token |
| ✅ | WebFetch/WebSearch 工具 | 网络获取与搜索，让 LLM 获取实时信息 |
| ✅ | **`/init` 命令** | 分析项目结构、发现构建/测试命令、记录架构和约定，生成 `nano-code.md` 代码库文档 |
| ✅ | 代码审查 `/review` | Review 内置 skill，审查 git diff 的正确性/性能/安全，输出 CRITICAL/WARNING/SUGGESTION 三级报告 |

## P1 — 规划、任务与记忆

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | Plan Mode | `enter_plan_mode`/`exit_plan_mode` + `plan_write`/`plan_list` 工具，`~/.nano-code/plan/` 文件持久化，4 阶段工作流（探索→设计→审查迭代→执行），写入工具拦截，`<system-reminder>` 两级节流（每 5 轮精简/完整交替），退出通知 |
| ✅ | 任务/清单系统 | `task_create`/`task_list`/`task_update`/`task_stop` 工具，文件持久化 |
| ✅ | 会话语义记忆 | 文件化记忆系统：MEMORY.md 索引 + topic 文件，onSystemPrompt 注入行为规则和索引，save_memory/recall_memory 工具，~/.nano-code/AGENT.md 用户全局偏好 |
| ✅ | 权限系统 | 轻量权限框架：PluginRegistry allowlist、agent permission gate、/permissions 命令、Ink 三选项弹窗 |

---

## P0 — 高频命令与监控

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | `/diff` / `/status` 命令 | 查看 git diff 和变更状态，支持 `--staged`、`--stat` 等原生 git 参数 |
| ~~✅ Monitor 工具~~ | ~~实时监控进程输出/日志文件事件流，覆盖「等 build 完成」「监视错误日志」场景~~ |
| ✅ | 插件生命周期钩子增强 | `onAgentExit` 子 agent 退出清理钩子 + `setStatusBar` 状态栏段落机制 + `AgentExitContext` |
| ☐ | Agent 工具增强 | run_agent 升级为一级工具，支持 structured_output schema、isolation 隔离模式、丰富 prompt 描述 |
| ☐ | **Plan Mode 多 Agent 并发** | Plan mode 内自动启动多个 Explore Agent 并行扫描代码库、多个 Plan Agent 并发设计方案，类似 Claude Code 的 5 阶段工作流 |
| ➖ | **Cron + Loop（后端）** | 旧 `node-cron` 实现已移除，迁移至 Agent 框架内置的 `CronCreate`/`CronDelete` 工具（由主循环调度，不依赖 `node-cron` 包） |
| ➖ | **Cron + Loop（Display 适配）** | 旧 cron 已移除，新定时任务由 Agent 框架的 `onStatus({ level: 'info' })` 统一处理 |

### 不需要实现（设计理念差异）

| 功能 | 原因 |
|------|------|
| `/cost` 命令 | nano-code 不追踪具体费用，token-budget 插件仅做用量上限控制 |
| `/config` 命令 | nano-code 配置设计为文件驱动（YAML + 分层 merge），运行时修改与配置分层设计矛盾 |

---

# 生产级就绪

## P0 — 崩溃与可靠性

| # | 状态 | 功能 | 说明 |
|---|------|------|------|
| 1 | ✅ | 全局错误边界 | 注册 `unhandledRejection`/`uncaughtException` 全局处理器，捕获后展示友好错误而非直接 crash |
| 2 | ✅ | 优雅退出 | `process.exit()` 前清理 MCP 子进程、恢复终端状态、保存会话，避免终端残留 |
| 3 | ✅ | MCP 子进程生命周期管理 | 主进程异常退出时自动 kill MCP 子进程，防止孤儿进程泄漏 |
| 4 | ✅ | 减少 `any` 类型 | `rawToolCall`、`args`、`err` 等 30+ 处 `: any` 改为具体类型，提升编译期安全性 |
| 5 | ✅ | package.json 补全 | 补充 `repository`、`bugs`、`homepage`、`engines`、`files`、`keywords` 字段，使 `npm publish` 可用 |

## P1 — 用户可诊断

| # | 状态 | 功能 | 说明 |
|---|------|------|------|
| 1 | ✅ | 结构化日志 | 替代 `console.log`/`console.error`，支持日志级别（debug/info/warn/error）、文件输出、`--verbose` 开关 |
| 2 | ✅ | 诊断命令 `nano-code doctor` | 一键验证：配置文件解析、API 连通性、插件加载、环境变量，输出诊断报告 |
| 3 | ☐ | 升级机制 | `nano-code upgrade` 检查 npm registry 最新版本并升级，启动时可选做版本检查 |
| 4 | ✅ | 配置版本化与迁移 | 配置文件添加 `configVersion` 字段，向后不兼容变更时自动迁移 |
| 5 | ✅ | 错误信息改进 | 替换 `"工具物理执行失败"` 等半中半英的笼统错误为用户可理解的描述 + 解决指引 |

## P2 — 开发者体验

| # | 状态 | 功能 | 说明 |
|---|------|------|------|
| 1 | ✅ | CI/CD | GitHub Actions：push/PR 自动跑测试 + tsc 类型检查，release tag 自动 npm publish |
| 2 | ☐ | CONTRIBUTING.md | 贡献指南：开发环境搭建、代码规范、PR 流程、测试要求 |
| 3 | ✅ | 依赖锁定 | `package-lock.json` 入版本库，`npm install` 的行为跨机器可复现 |
| 4 | ✅ | npm publish 产出物 | 配置 `files` 字段或 `.npmignore`，只发布 `dist/` + `README.md` + `LICENSE`，不发布源码和测试 |
| 5 | ✅ | E2E 测试 | 端到端 agent 循环测试：模拟 LLM 响应，验证工具调用 → 结果回注 → 下一轮循环的全链路 |

## P3 — 锦上添花

| # | 状态 | 功能 | 说明 |
|---|------|------|------|
| 1 | ☐ | 一键安装脚本 | `curl -fsSL https://nano-code.dev/install.sh` 自动检测系统、安装 Node.js、配置 API key |
| 2 | ☐ | 可选 Telemetry | 用户可选的匿名使用统计（启动次数、常用命令、错误率），帮助开发者诊断问题；默认关闭，首次使用询问 |
| 3 | ☐ | 配置校验增强 | 运行时对 YAML 配置做完整 JSON Schema 校验，报错时精确定位到具体字段 |
| 4 | ☐ | LLM 速率限制处理 | 429 响应时读取 `Retry-After` 头，智能等待而非固定指数退避 |
| 5 | ✅ | 并发工具执行 | 多个无副作用的工具调用（如 read_file）并行执行，减少总等待时间 |

## 展示层插件（已实现）

`DisplayPlugin` 接口已经抽象，当前内置两个展示层插件：

| 场景 | 状态 |
|------|------|
| **REPL**（`@clack/prompts` + console） | ✅ 已实现 |
| **Ink 全屏终端 UI**（类 Claude Code 体验） | ✅ 已实现 |
| **子 agent 前缀**（带 `[name]` 输出） | ✅ 已内建 |
| **`--think` 思考内容视觉区分**（灰色斜体） | ✅ 已实现 |
| **斜杠命令建议弹出**（`/` 开头弹出技能列表 + 实时过滤 + Tab 补全） | ✅ 已实现 |
| **输入框模式变色**（`!` → 粉框 / `/` → 紫框） | ✅ 已实现 |
| **Plan Mode 状态指示器**（底栏 plan badge + 任务数量） | ✅ 已实现 |
| **Display 事件携带 tool_call_id**（onToolCall/onToolResult 含 id 字段，便于前后端事件关联） | ✅ 已实现 |
| **ESC 不退出主视图**（类似 vim，ESC 仅退出编辑模式） | ✅ 已实现 |
| **工具调用显示美化**（displayName + 统一 formatToolCall） | ✅ 已实现 |
| **多行输入支持**（Shift+Enter / `\`+Enter 换行） | ✅ 已实现 |
| **多行光标导航**（↑/↓ 在输入行间移动，到首/末行进历史，列位置保持） | ✅ 已实现 |
| **输入框自动增高**（随行数自动扩展，maxHeight 限制） | ✅ 已实现 |
| **xterm modifyOtherKeys 始终启用**（Shift+Enter 修饰键检测覆盖所有 xterm 类终端） | ✅ 已实现 |
| **弹框 ESC/Ctrl+C 关闭**（权限/问题弹框可通过 ESC 或 Ctrl+C 关闭并终止 ReAct） | ✅ 已实现 |
| **问题对话框自定义输入**（「其它」选项 + 多行输入 + 提交前确认） | ✅ 已实现 |
| **全局 stderr 拦截**（拦截第三方直写 stderr，路由到 Ink 消息系统，防止多 monitor 场景下 alt-screen 被腐蚀） | ✅ 已实现 |
| **极简模式**（`readline` 裸输入） | ☐ 未实现 |
| **CLI one-shot 模式**（stdin/stdout 管道，cli-display 插件就绪） | ☐ 待接入 |
| **Web UI**（HTTP/WebSocket — 由外部插件 [preprocess-cn/nano-code-web](https://github.com/preprocess-cn/nano-code-web) 提供） | ✅ 外部插件 |

Ink 展示层（`claude-code-ink`）基于 React + 自研 Ink 引擎（fork 自 Claude Code），支持 ScrollBox 滚动、全屏 terminal UI、`--think` 思考内容灰色斜体视觉区分、`/` 斜杠命令建议弹出与实时过滤、`!`/`/` 输入框模式边框变色、Plan Mode 状态指示器（底栏 `○ normal`/`● PLAN` 徽标 + 任务数量）、问题对话框自定义输入（「其它」选项 + 多行文本 + 提交前确认）、弹框 ESC/Ctrl+C 关闭等功能。

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

### Agent 协调层

Agent 协调功能集中在 `src/plugins/coordinator/`：
- `coordinator.ts` — AgentCoordinator 插件，统一注册和管理所有 agent 工具
- `agent-loader.ts`（`src/core/`）— 扫描 `~/.nano-code/agents/*.yaml`，校验并加载 agent 定义
- `agent-tool.ts` — 包装 agent 定义为 NanoPlugin 工具，每个调用创建独立子 agent
- `task-manager.ts` — 后台任务调度（依赖 AgentLifecycle 真实中止子 agent）
- `lifecycle.ts` — AgentLifecycle 单例，管理 AbortController 层次结构
- `message-bus.ts` — MessageBus 单例，信箱模式 agent 间消息传递
- `messaging-plugins.ts` — send_message 和消息投递插件

