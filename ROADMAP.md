# 开发路线图

## P0 — 核心可靠

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | `--list-plugins` | 列出已注册插件及其工具 |
| ✅ | 配置测试覆盖 | config.ts 合并逻辑测试 |
| ✅ | Agent 测试覆盖 | getHistory / loadHistory 测试 |
| ✅ | 会话持久化 | `-c`/`--continue` 接续上次对话，`finally` 块自动保存 |

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
| ☐ | CI/CD | GitHub Actions + 自动测试 |
| ☐ | 发布准备 | package.json 补全、README 更新、npm publish |
| ☐ | 插件权限系统 | npm 插件的安全沙箱 + 权限声明机制 |
| ☐ | 插件热加载 | 运行时开关插件无需重启 |
| ☐ | 上下文裁剪与压缩 | 基于 analyzer 数据的智能摘要/裁剪 |
| ☐ | **Ink 上下文可视化** | 参考 Claude Code `ContextVisualization.tsx`，在 Ink display 中渲染色块网格，数据源为 `analyzer.ts` 的 7 维度分析 |
| ☐ | 多轮摘要记忆 | 超出窗口时自动压缩历史 |
| ☐ | 角色模式 & 斜杠命令 | profiles/ 斜杠命令 `/treehole` 等运行时切换 |
| ✅ | 内置 Skill 系统 | 10 个对齐 Claude Code 的内置技能：simplify/verify/batch/debug/lorem-ipsum/update-config/remember/stuck/skillify/keybindings |
| ☐ | ToolUseContext | 工具执行的共享运行时上下文（模型覆盖、effort、权限绑定等），贯穿 ReAct 循环 |
| ☐ | contextModifier | 工具可通过 ToolResponse 返回上下文修改器，作用于后续工具调用的执行环境 |
| ✅ | Skill 系统 | 10 个内置 TypeScript 技能（bundled），skills_list / skill_view / skill 工具，inline（newMessages 注入）+ fork（子 agent）双模式，skills 配置禁用开关 |

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
| **极简模式**（`readline` 裸输入） | ☐ 未实现 |
| **CLI one-shot 模式**（stdin/stdout 管道） | ☐ 未实现 |
| **Web UI**（HTTP/WebSocket） | ☐ 未实现 |

Ink 展示层（`claude-code-ink`）基于 React + 自研 Ink 引擎（fork 自 Claude Code），支持 ScrollBox 滚动、全屏 terminal UI、`--think` 思考内容灰色斜体视觉区分、`/` 斜杠命令建议弹出与实时过滤、`!`/`/` 输入框模式边框变色等功能。

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
- **DisplayPlugin 生命周期事件**：`onAgentTurnStart/End`、`onStateSnapshot`，插件可感知 agent 任务开始/结束
- **额外参数注入（extraParams）**：`NanoPlugin.onExtraParams()` 钩子，`PluginRegistry.collectExtraParams()` 收集，agent 自动透传 LLM API
- **usage 剥离**：`LLMResponse` 不再包含 usage，改为 `onMeta` 回调 + `rawMeta` 参数由插件自行解析（`token-budget` 插件已适配）
- **插件间共享状态（IStore）**：`IStore` 接口（`get/set/subscribe`），默认 `InMemoryStore` 实现，位于 `src/plugins/store/`，可替换为任何后端存储
- **Ink 斜杠命令建议弹出**：输入 `/` 开头时自动弹出技能/命令列表，实时过滤，键盘导航 ↑↓ Tab Enter Esc，Tab 补全命令名
- **Ink 输入框模式变色**：`!` 开头边框变粉色（`#ff0087`）、`/` 开头变紫色（`#7c3aed`），正常灰色（`#6b7280`）
- **技能/命令桥接层**（`skills-bridge.ts`）：独立文件管理跨插件依赖（skills + commands），通过 provider 模式注入 Ink 显示层
