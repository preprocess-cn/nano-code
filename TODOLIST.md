# TODO List

## 已完成（v1 重构）

- [x] **核心类型定义** — `src/contract.ts`（ToolResponse, ToolDefinition, ToolContext）
- [x] **插件系统** — `src/plugin.ts`（NanoPlugin, PluginRegistry, 5 个通用钩子）
- [x] **配置系统** — `src/config.ts`（两级加载 + 命名空间隔离）
- [x] **Agent 重构** — `src/agent.ts` 接入 PluginRegistry，支持钩子编排
- [x] **提示词组装器** — `src/prompt.ts`（Core 指令 → AGENT.md → 插件钩子）
- [x] **LLM 重试退避** — 3 次指数退避（1s, 2s, 4s）
- [x] **工具抽取为插件** — `src/plugins/tools/fs.ts` + `command.ts`
- [x] **清理旧 tools/ 目录** — 删除 7 个旧文件
- [x] **测试更新** — 32/32 通过

## 下一步开发计划

### 1. MCP Adapter（高优先级）
- [x] 实现 `src/plugins/mcp/adapter.ts`
- [x] MCPClient 类：JSON-RPC 2.0 over stdio（子进程 spawn）
- [x] MCPPluginAdapter：将 MCP Server 包装为 NanoPlugin
- [x] 生命周期管理：启动、握手、初始化、销毁清理
- [x] 配置驱动：从 `config.plugins.mcp-xxx` 自动加载

### 2. Token 预算插件（高优先级）
- [x] 创建 `src/plugins/token-budget.ts`
- [x] `onBeforeRequest`：统计历史 token、超预算时注入约束指令
- [x] `onAfterRequest`：记录每次请求的 token 消耗
- [x] `onBeforeToolCall`：超预算后拒绝新工具调用
- [x] 历史压缩：接近预算时自动注入简洁指令
- [x] 配置项：maxTokensPerSession, maxTokensPerRequest, compressionThreshold, warnAtTokens

### 3. 零插件模式验证（中优先级）
- [x] 确保无工具时 Agent 正常退化为聊天模式
- [x] 友好的提示信息（"当前未启用任何工具插件"）

### 4. 记忆系统插件（中优先级）
- [x] 创建 `src/plugins/memory.ts`（提供 save_memory / recall_memory 工具，支持标签分类和关键词检索）
- [ ] `onAfterRequest`：从对话中自动提取关键信息保存（当前为 no-op 预留）
- [ ] `onBeforeRequest`：检索相关记忆注入到 system prompt

### 5. 上下文展示插件（中优先级）
- [ ] 创建 `src/plugins/context-ui.ts`
- [ ] `onAfterRequest` / `onAfterToolCall`：在终端绘制状态面板
- [ ] 显示：token 累计、工具调用次数、活跃插件列表、会话时长

### 6. 技能系统（低优先级）
- [ ] `plugins/skills/` 目录自动发现 + 加载
- [ ] 纯 prompt 型 skill 注册为 NanoPlugin（仅 onSystemPrompt）
- [ ] 带工具型 skill：支持自定义工具注册
- [ ] 示例 skill：code-review, systematic-debugging 等

### 7. 更多内置插件（低优先级）
- [ ] web-fetch 插件（HTTP 请求工具）
- [ ] git 插件（常用 git 操作）
- [ ] search 插件（文件内容搜索）
- [ ] thinker 插件（内置 think 工具，让模型可以显式"思考"）

### 8. 文档（低优先级）
- [ ] README 更新：新架构说明
- [ ] MCP 集成指南：如何接入外部 MCP Server
- [ ] 配置文档：config.json 字段说明
