# 开发路线图

## P0 — 核心可靠（当前）

| 状态 | 功能 | 说明 |
|------|------|------|
| ✅ | `--list-plugins` | 列出已注册插件及其工具 |
| ✅ | 配置测试覆盖 | config.ts 合并逻辑测试（13 用例） |
| ✅ | Agent 测试覆盖 | getHistory / loadHistory 测试（5 用例） |
| ✅ | 会话持久化 | `-c`/`--continue` 接续上次对话，`finally` 块自动保存 |

剩余：端到端的会话接续集成测试。

## P1 — 日常体验

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 1 | **npm 插件加载器** | ~2d | 实现 `type: 'npm'`，支持 `import()` 加载 npm 包为 NanoPlugin |
| 2 | **`plugin` CLI 子命令** | ~1d | `nano-code plugin install/list/remove`，插件生命周期管理 |
| 3 | **配置校验** | ✅ | 载入 config.json 时做 schema 校验，及早发现拼写错误 |
| 4 | **配置 merge 精简** | ✅ | 用泛型 mergeTypedFields 替代重复的类型检查模板 |
| 5 | **agent runTask 职责拆分** | ~1h | 将 think-tag 过滤/流处理/工具调度拆出独立方法 |

## P2 — 能力增强

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 6 | **会话上下文修剪** | ~2d | token-budget 之上做智能摘要/裁剪，防止长对话撞窗口上限 |
| 7 | **LLM 失败重试** | ✅ | 3 次指数退避（1s, 2s, 4s） |
| 8 | **多轮摘要记忆** | ~3d | 超出窗口时自动压缩历史，参考 Claude 的 context management |

## P3 — 生态准备

| # | 功能 | 预估 | 说明 |
|---|------|------|------|
| 9 | **CI/CD** | ~3h | GitHub Actions + 自动测试 |
| 10 | **发布准备** | ~4h | package.json 补全、README 更新、npm publish |
| 11 | **插件权限系统** | ~3d | npm 插件的安全沙箱 + 权限声明机制 |
| 12 | **插件热加载** | ~2d | 运行时开关插件无需重启 |

## 已实现功能

- ReAct Agent 循环 + 流式 LLM 通信
- 插件注册中心（PluginRegistry）：注册、注销、工具路由、钩子链
- 内置插件：fs（文件读写 + patch）、command（bash 执行 + 安全黑名单）
- MCP 集成：通过 stdio JSON-RPC 加载任意 MCP Server
- Token-budget 插件：会话/请求级别 token 用量跟踪与限制，使用 API 精确 token 统计
- 无工具时自动降级为纯对话模式
- agent 角色和启动提示可配置化
- `--list-plugins` 插件清单
- 会话持久化 `-c`/`--continue`
