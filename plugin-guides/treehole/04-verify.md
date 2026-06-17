---
phase: 4
name: verify
next: null
---

# 阶段 4：验证与测试

## 目标

端到端验证树洞插件能正确工作，包括启动、角色表现和记忆持久化。

## 背景信息

至此已完成：
- Memory 插件代码（`src/plugins/tools/memory.ts`）
- 系统提示词动态描述（`src/prompt.ts`）
- CLI --profile 支持（`src/index.ts`）
- 树洞 profile 配置

## 操作步骤

### Step 1: 编译验证

运行 `npm run build`，确认 TypeScript 编译无错误。

### Step 2: 启动树洞模式

运行 `nano-code --profile treehole`，验证：

- [ ] 启动时显示角色名：`角色配置：treehole`
- [ ] 启动时显示树洞的问候语
- [ ] `fs` 和 `command` 工具不可用
- [ ] `save_memory` 和 `recall_memory` 工具可用

### Step 3: 功能验证

进入树洞模式后，与它进行对话：

1. 分享一些个人信息，观察 AI 是否会使用 `save_memory` 保存
2. 开始新话题，观察 AI 是否自然地回应而不是急于给建议
3. 确认 AI 没有尝试调用文件或命令工具

### Step 4: 记忆持久化验证

1. 在树洞模式中分享一些信息
2. 退出（输入 exit）
3. 使用 `nano-code --profile treehole --continue` 重新进入
4. 验证 AI 是否能回忆起之前的信息

## 成功标准

- AI 角色的语气符合树洞设定（温暖、共情、不评判）
- 只有记忆工具可用，fs/command 被禁用
- 记忆可以跨会话持久化
- 用户感觉被倾听和理解，而不是被分析和给建议

## 产出物清单

- 无（验证阶段，不产生新文件）

## 验证方法

```
# 编译
npm run build

# 启动树洞模式
nano-code --profile treehole

# 启动树洞模式并恢复会话
nano-code --profile treehole --continue
```
