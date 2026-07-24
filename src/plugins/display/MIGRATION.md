# TUI 功能差异文档

对比 Claude Code TUI 的参考实现，记录当前 nano-code TUI 的功能差异。

> 更新于 2026-07-24
> 以下功能标注 `✅` 表示已实现，`⚠️` 表示部分/简易版，`❌` 表示仍缺失

## 设计原则差异

| 维度 | Claude Code | nano-code |
|------|-------------|-----------|
| 渲染引擎 | React Ink（自定义 reconciler） | React Ink（fork 自 CC，自有 reconciler） ✅ |
| 状态管理 | React Context + AppState | React Context + AppState ✅ |
| 动画 | useAnimationFrame(50ms) hook | useAnimationFrame(50ms) hook ✅ |
| 虚拟列表 | VirtualMessageList（按需渲染） | ScrollBox（增量渲染，非虚拟化） ❌ |

## 已实现功能

- ✅ 三区布局（内容区 / 输入区 / 状态栏）
- ✅ 流式 Markdown 渲染（StreamingMarkdown 块级缓存 + 增量刷新）
- ✅ Spinner 动画指示器（SpinnerWithVerb，50ms starburst 帧 + 耗时 + token 计数 + stalled 检测）
- ✅ 状态栏（暗底，mode 指示器 · model ctx · tokens · 通知轮播）
- ✅ 输入历史导航（Alt+P/N）
- ✅ 自动滚动 + 用户滚动锁定 + PageUp/PageDown
- ✅ `/` 斜杠命令 / `@` agent 建议弹窗
- ✅ Context 上下文用量可视化（ContextVis 色块 + 图例 + 汇总行）
- ✅ Diff 行级对比（ColorDiff + DiffView，highlight.js 语法高亮 + word-level diff）
- ✅ 搜索模式 / 高亮（SearchBox + useSearchHighlight）
- ✅ 权限对话框（允许一次 / 始终允许 / 拒绝）
- ✅ 问答对话框（QuestionsDialog，单选 / 多选 / 自定义输入）
- ✅ Agent 内联追踪列表（AgentTrackerBar，输入框下方）
- ✅ 后台任务栏（BackgroundTaskBar）
- ✅ 多行输入（Shift+Enter 换行，↑↓ 行内导航，自动增高）
- ✅ 输入框模式变色（`!` 粉框 / `/` 紫框）
- ✅ 全局 stderr 拦截（防 alt-screen 污染）
- ✅ ESC 不退出主视图（类似 vim，仅退出编辑模式）
- ✅ 弹框 ESC/Ctrl+C 关闭并终止 ReAct
- ✅ 消息分组折叠（连续同类 toolCall 自动折叠 + Ctrl+O transcript 展开）

## 缺失功能

### Agent 展示层（与 CC 差距最大的领域）

#### 1. TeammateSpinnerTree — 实时 Agent 树
- **CC 参考**: `TeammateSpinnerTree.tsx` + `TeammateSpinnerLine.tsx`
- **差异**: CC 在消息流底部 spinner 区域显示**实时更新的 agent 树**，带树形连接符（`╒═`/`├─`/`└─`）、活动文本摘要、tool/token 统计、Leader + Teammate 层级。nano-code 使用消息流内联行模拟，无实时更新能力。
- **优先级**: **高**（这是 CC 多 agent 体验的核心组件）
- **CC 功能细节**:
  - 树形连接符：选中态 `╒═`/`╞═`/`╘═`，普通态 `┌─`/`├─`/`└─`
  - Leader 行（cyan 色）+ agent 行（各自 identity color）
  - 活动文本：agent 正在做的事（取自 `recentActivities` 摘要）
  - 宽度自适应：≥80列显示名称+活动+统计，60-80仅名称+活动，<60仅活动
  - 预览行：`showPreview=true` 时显示 agent 最近消息末尾 3 行
  - 选择模式：选中行显示折叠行 `hide · enter to collapse`

#### 2. AsyncAgentDetailDialog — Agent 详情弹窗
- **CC 参考**: `AsyncAgentDetailDialog.tsx`
- **差异**: CC 在 agent 列表中选中后按 Enter 弹出 Dialog，展示完整执行详情。nano-code 无此组件。
- **优先级**: **中**
- **CC 功能细节**:
  ```
  ┌─ Dialog ──────────────────────────────────────┐
  │  code-reviewer › Run ESLint on src/           │  ← title
  │  Completed · 3m 12s · 1,234 tokens · 15 tools │  ← subtitle
  │                                               │
  │  Progress                                      │
  │  › Read src/main.ts                           │  ← recentActivities
  │  › Run: npx eslint src/                       │
  │                                               │
  │  Prompt                                       │
  │  Run eslint on all files under src/...        │  ← prompt (截断 300ch)
  │                                               │
  │  ← go back  Esc/Enter/Space                                                   │  ← 键盘提示
  └───────────────────────────────────────────────┘
  ```
  - Progress 区块：`status=running` 且有 `recentActivities` 时显示
  - Prompt/Plan 区块：无 plan 标签显示 prompt（截断 300ch），有 `<plan>` 标签渲染为 `UserPlanMessage`
  - Error 区块：`status=failed` 且有 error 时红色显示
  - 快捷键：`←` 返回，`Esc`/`Enter`/`Space` 关闭，`x` 停止运行中 agent

#### 3. AgentProgressLine — 内联 Agent 进度行
- **CC 参考**: `AgentProgressLine.tsx`
- **差异**: CC 在主对话流中以内联树形结构显示子 agent 进度，带类型标签背景色、工具计数、token 统计。nano-code 使用普通消息行模拟。
- **优先级**: **中**
- **CC 功能细节**:
  ```
    ├─ CODE_REVIEW (review) · 5 tool uses · 890 tokens
    │  ─ Running linter…
    └─ BUG_FIX · 3 tool uses · 456 tokens
       ─ Done
  ```
  - `hideType=false`: `[CODE_REVIEW] (review)` 背景色标签 + 描述
  - `hideType=true`: `name: description` 纯文本模式
  - `isLast` 控制连接符 `├─`/`└─`
  - `isResolved`/`isError` 标记完成/出错状态
  - `lastToolInfo` 显示最后工具调用描述

#### 4. Agent 列表缺少 main 行 + 图标区分
- **CC 参考**: `CoordinatorTaskPanel` 中的 main 行
- **差异**: CC 底部 Agent 面板第一行是 `○ main`，nano-code 的 AgentTrackerBar 无 main 行
- **优先级**: 低

#### 5. 已完成 Agent 保留展示（⏸ 图标）
- **差异**: CC 保留已完成 agent 用 `⏸` 图标，nano-code 的 AgentTrackerBar 在 `running.length === 0` 时 `return null`，完成即消失
- **优先级**: 低

#### 6. 队列统计
- **差异**: CC 在 agent 行右侧显示 `· 3 queued` 排队数量（warning 色），nano-code 无此功能
- **优先级**: 低

#### 7. 自动过期驱逐（Eviction）
- **差异**: CC 有 1s tick 定时检查 `evictAfter` 时间戳自动清除过期 agent，nano-code 无此机制
- **优先级**: 低

### Tool 调用展示差异

#### 8. ToolUseLoader — 工具调用动画指示器
- **CC 参考**: `ToolUseLoader.tsx`
- **差异**: CC 在每个 tool 调用行使用闪烁的 `●`（black circle，`useAnimationFrame` 控制），状态流转为未解析→成功绿✓→失败红✗。nano-code 使用彩色文本状态标签。
- **优先级**: **中**（现有方案可用，但视觉效果差距明显）
- **CC 状态颜色**: 未解析=dim 色闪烁，解析成功=success 色，出错=error 色

### 布局与交互差异

#### 9. 权限弹窗位置
- **差异**: CC 权限弹窗固定在 bottom 区域（不随消息滚动），nano-code 放在 ScrollBox 内（随消息滚动）。用户滚动查看历史消息时权限弹窗可能不可见。
- **优先级**: **中**

#### 10. 虚拟化消息列表
- **参考**: `VirtualMessageList.tsx`
- **影响**: 超长会话中性能下降（无按需渲染，所有消息节点都在 DOM 中）
- **优先级**: **中**

#### 11. 消息分组折叠  ✅
- **参考**: `Messages.tsx` 中 `collapsed_read_search`、`grouped_tool_use`
- **状态**: 已实现。连续同类 toolCall 自动折叠为 dim 摘要行 `toolName × N (ctrl+o to expand)`，Ctrl+O transcript 模式展开所有组。
- **实现**: `InkApp.tsx` 中 `groupMessages()` 函数 + `transcriptMode` 全局控制

#### 12. 状态栏自定义（Shell Hook）
- **差异**: CC 通过 `executeStatusLineCommand` 执行用户配置的 shell 命令生成状态栏，支持 model/workspace/cost/context_window/rate_limits/vim/agent/remote/worktree 等字段，300ms 防抖，`memo` 优化。nano-code 使用插件层 `setStatusBar()` 直接传入静态 KEY:VALUE。
- **优先级**: 低

#### 13. 选择模式（Selection Mode）
- **差异**: CC 支持 `viewSelectionMode === 'selecting-agent'` 下的批量选择操作，每行前显示选择指示符。nano-code 无此功能。
- **优先级**: 低

### 视觉与交互细节

#### 14. 闪烁 / 流光文字效果（Glimmer）
- **参考**: `GlimmerMessage.tsx`
- **影响**: Spinner 消息无扫描光线动画
- **优先级**: 低（视觉细节）

#### 15. Logo
- **差异**: CC 使用图形化 `LogoV2` 组件，nano-code 使用 ASCII art greeting
- **优先级**: 低

#### 16. 鼠标交互
- **差异**: CC Agent 列表支持 hover 显示 `❯` 指示符、click 选中/查看。nano-code 目前仅键盘导航。
- **优先级**: 低

#### 17. 页脚快捷操作栏（Footer Suggestions）
- **参考**: `PromptInputFooterSuggestions.tsx`
- **影响**: 无 `/artifacts`、`/problem` 等底部快捷操作按钮
- **优先级**: 低

#### 18. Vim 模式
- **参考**: `VimTextInput.tsx`
- **影响**: 不支持 vim 快捷键
- **优先级**: 低

#### 19. 帮助菜单
- **参考**: `PromptInputHelpMenu.tsx`
- **影响**: 无 `?` 快捷键帮助弹窗
- **优先级**: 低

#### 20. 搜索模式（Ctrl+R 历史搜索）
- **参考**: `HistorySearchInput.tsx`
- **影响**: 不能搜索历史命令
- **优先级**: 低

#### 21. 粘贴处理
- **参考**: `inputPaste.ts`
- **影响**: 大段粘贴无节流或确认
- **优先级**: 低

#### 22. Cmd+K 清除 / 历史
- **参考**: `HistorySearchDialog.tsx`
- **影响**: 不能查看/搜索历史对话
- **优先级**: 低

#### 23. 全屏模式
- **参考**: `FullscreenLayout.tsx`
- **影响**: 不支持 alt-screen 切换
- **优先级**: 低

## 设计决策

### 颜色主题
- 基于 `#0a0a0a` 纯黑背景，与 Claude Code 一致
- accent 色 `#6faaff` 对应 Claude Code 蓝色强调
- 代码使用 `#ce9178`（暖色），与 VS Code 相似

### 输入区 UI
- 左缩进 2 字符，无显式 prompt 符号（Claude Code 也无 `>` 标记）
- Shift+Enter 换行，Enter 提交

### Spinner 位置
- 作为内容区最后一行渲染（非独立浮动元素）
- 消息 + 时间 + token 在同一行，用 `·` 分隔

### 状态栏
- 1 行固定底部
- 左侧显示 mode + model ctx + token 计数值
- 右侧可用于扩展信息