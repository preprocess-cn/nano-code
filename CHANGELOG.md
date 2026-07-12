# Changelog

## v0.1.3 (2026-07-12)

### Features
- 统一消息队列 + Ink 展示层重构 + notify-manager 修复 — 核心层新增 `src/core/message-queue.ts` 模块级单例队列，所有输入统一经过队列；Ink display 渲染提前到 onStart，prompt 退化为永不 resolve 的 Promise；状态栏左右独立布局；DisplayManager 增加 `onDebug` 方法 ([7a2b90b])

### Bug Fixes
- 拦截 `process.stderr.write` 防止多 monitor 场景下 Ink alt-screen 被腐蚀 — 多 monitor 并行高频 render() 触发 React 内部 console.error 直通 stderr 破坏全屏画布 ([a3ba56b])
- `plugin install/enable` 误用 JSON 读写 YAML 配置文件 — addToProjectConfig 和 setEnabled 对 `.nano-code.yaml` 使用 JSON.parse/JSON.stringify 导致 YAML 格式被覆盖，改为 yaml.load/yaml.dump ([68fa319])
- `togglePlugin`（/plugin enable/disable）同样误用 JSON 读写 YAML ([fcb9cf0])
- NotifyManager 队列清空后 timer 未重置导致后续通知无法调度 ([7f4616b])
- scope 路由测试改用 `_addToScopeConfig` 避免 Node 20 `import()` 触发 structuredClone bug ([2f9a51a])
- plugin-cli 测试使用临时目录避免 Node 20 structuredClone 序列化错误 ([37bdc6a])
- CI 触发器从 master 更新为 main ([f81a149])

### Tests
- 验证 plugin enable/disable 写入 YAML 格式而非 JSON ([ca8a5a6])

### Documentation
- 标记 Web UI 状态为外部插件，指路 preprocess-cn/nano-code-web ([71bbaae])

---

## v0.1.2 (2026-07-10)

### Features
- Plan Mode 重构 — `plan_write`/`plan_list` 工具 + 4 阶段工作流 + 安全加固（写入工具拦截、提醒节流、退出通知）([ec33712])
- Plan Mode 提示词精简 + full/sparse 交替机制 + 意图判断退出 ([25a96a0])
- 核心层解耦 — plan mode 注入 / display 初始化迁出核心 + 文件结构重组 ([f560aaf])
- 核心层净化 — 配置代码迁出至 bootstrap + 文件归属重组 ([3efde11])
- 核心层瘦身 — 基础设施迁出至 utils/bootstrap ([69e4581])
- 全局状态栏 + NotifyManager 通知管理 ([f32abe8])
- PluginRegistry InteractiveHandler 桥接机制 + REPL 流分页器 + 问题对话框修复 ([72cf5b7])
- 工具级自定义超时 + 问题对话框"其它"选项 + ESC/Ctrl+C 弹框关闭 ([a877993])
- 添加 onAgentExit 钩子和 DisplayPlugin setStatusBar 接口 ([62f8f39])
- plugin install 支持 DisplayPlugin 自动检测与安装 ([f62ce95])

### Bug Fixes
- version.ts 改为从 package.json 动态读取，修复版本不同步问题 ([1e7da22])
- 移除 StderrLogPlugin 默认注册，日志改为只走 display-bridge ([f1be9ab])

### Refactors
- 展示层接口隔离 — 插件不再依赖完整 DisplayManager ([cbdf8bf])
- 移除已迁移的核心层文件（agent-loader/doctor/mcp-config/tool-display）([a86cdd5])

---

## v0.1.1 (2026-07-08)

### Features
- 多行输入 + 架构文档 + 建议弹出窗口 Shift+Enter 修复 ([85b9ed1])
- 工具调用显示美化 + ESC 主视图保护 ([aacef42])
- Cron/Loop 定时任务系统 + 并行只读工具执行 ([0ada994])
- /diff /status 命令 + Monitor 工具 + 系统插件注册合并 ([608ef5b])
- commit / commit-pr 内置技能 — 创建 Git 提交和 Pull Request ([0f78a79])

### Refactors
- 插件注册体系拆分 + 旧 cron/loop 移除 + 生命周期钩子 ([617b11f])

### Bug Fixes
- 提交未跟踪的 token-counter.ts（CI type check 缺少此文件）([32007e9])
- REPL cron 通知显示 + isMeta 消息追加到末尾不破坏缓存 ([ddc2ed7])
- 简化 review 发现 — 移除 monitor 重复权限门/死代码，共享危险命令黑名单 ([3482d0e])
- display 事件 onToolCall/onToolResult 缺少 tool_call_id ([0453691])

### Chores
- 移除已删除 cron 系统的依赖包 node-cron ([7b53e59])

---

## v0.1.0 (2026-07-07)

### Initial Release

nano-code 首个发布版本 — 轻量级 CLI AI 编程助手。

### Core Architecture
- 插件化 ReAct Loop 架构 — `NanoCodeAgent.runTask()` 实现工具调用循环
- `NanoPlugin` 接口 + `PluginRegistry` 插件注册与路由
- 展示层插件化（`DisplayPlugin`）— REPL + Ink TUI 双实现
- 多级 YAML 配置系统（全局 → 项目 → profile 覆盖）
- OpenAI 兼容 API 流式调用 + 重试逻辑

### Built-in Plugins
- **fs** — 文件系统工具（list/read/write/patch）
- **command** — Bash 命令执行 + 危险命令黑名单
- **memory** — 持久化记忆存储（save/recall with tags）
- **token-budget** — Token 用量追踪与预算控制
- 子 agent 工具 — 递归调用独立 NanoCodeAgent 实例

### MCP 支持
- stdio/HTTP JSON-RPC 传输适配
- 指数退避重试 + 请求超时 + 资源清理

### Display 层
- REPL 终端交互 + ThinkStream `<think>` 标签过滤
- Ink TUI 全屏界面 + 权限确认对话框 + 命令输出分页
- 插件间共享状态 `IStore` + 额外参数透传

### 插件系统
- `sideEffect` 标记（只读工具自动执行，无需确认）
- npm 包动态加载（`import()`）作为 NanoPlugin
- CLI 命令：`nano-code plugin install/list/enable/disable`
- agent profile 角色配置系统 + guide 引导文件
