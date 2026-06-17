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

## P3 — 生态准备

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 9 | **CI/CD** | ~3h | GitHub Actions + 自动测试 |
| 10 | **发布准备** | ~4h | package.json 补全、README 更新、npm publish |
| 11 | **插件权限系统** | ~3d | npm 插件的安全沙箱 + 权限声明机制 |
| 12 | **插件热加载** | ~2d | 运行时开关插件无需重启 |
| 13 | **更多内置插件** | ~2d | 按需提供数据库、HTTP 请求等常用插件 |

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
