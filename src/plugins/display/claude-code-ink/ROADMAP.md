# TUI Ink 展示层 Roadmap

> 记录代码评审发现的 bug、已修复项和改进建议。
> 更新于 2026-07-24

## 已修复

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| 1 | **ToolCallIndicator 闪烁速度减半** | `InkApp.tsx:161` | `useBlink(isUnresolved, 300)` 传入 300ms 恢复原始 600ms 完整闪烁周期。旧代码 `useAnimationFrame(300)` 产生 600ms 周期，新代码 `useBlink()` 默认 600ms 参数产生 1200ms 周期。 |
| 2 | **`|| isError` 死逻辑** | `InkApp.tsx:165` | 删除 `|| isError`。当 `status='error'` 时 `!isUnresolved` 已短路返回 `'●'`，`isError` 永远不执行。 |
| 3 | **dimColor 导致 running 指示器变暗** | `InkApp.tsx:170` | `dimColor: false`。旧代码 running 状态全亮度显示闪烁圆点，新代码不应降低指示器亮度。 |
| 4 | **折叠组对齐 CC 风格** | `InkApp.tsx` | 移除 per-group `onClick` 和 `expandedFoldGroups` state。折叠组默认收起为 dim 摘要 `toolName × N (ctrl+o to expand)`，Ctrl+O 一次性展开所有组。对齐 CC 的 `CollapsedReadSearchContent` 设计。 |

## 未修复

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 5 | **折叠组 key 不稳定** | `InkApp.tsx:209` | 折叠组 id 为 `fold-${i}`，基于消息数组起始索引。子 agent 消息插入后删除（`index.ts:649`）会导致 key 偏移，触发 React DOM 重建。 |
| 6 | **搜索遗漏折叠消息** | `InkApp.tsx:738` | 搜索扫描遍历 `messageRefs`，折叠组收起时子消息 ref 为 null 被 `continue` 跳过。 |

## 建议后续改进

### 1. UIMessage 增加 `toolName` 字段

消除 `extractToolName()` 逆向解析。

- 现状：`groupMessages` 调用 `extractToolName()` 从 `msg.text`（`DisplayName(args)` 格式）中解析工具名，与 `formatToolCall()` (`tool-display.ts:86`) 形成隐式耦合
- 建议：在 `UIMessage` 接口中增加 `toolName: string` 字段，`index.ts:785` 创建消息时填入 `event.toolName`，`groupMessages` 直接读字段
- 收益：消除 `extractToolName` 函数 + 消除与 `formatToolCall` 格式的耦合

### 2. 折叠功能抽取为独立 hook/组件

- 现状：折叠逻辑直接内联在 1600+ 行的 `AppContent` 中
- 建议：抽取 `useMessageFolding` hook 和 `FoldGroup` 组件
- 收益：可测试性 + 其他 display 插件可复用

### 3. useBlink API 语义改进

- 现状：`useBlink(enabled, intervalMs)` 的 `intervalMs` 实际传给 `useAnimationFrame` 作为 tick 间隔，完整闪烁周期为 `2 × intervalMs`
- 建议：改为 `useBlink(enabled, periodMs)`，内部 `intervalMs = periodMs / 2`
- 收益：调用者传 `useBlink(true, 600)` 得到 600ms 周期，语义清晰
