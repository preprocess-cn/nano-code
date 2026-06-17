---
name: nano-code-plugin-guide-template
description: 创建 nano-code 插件的引导文件模板。任何 AI 编程工具可据此分步创建插件。
---

# nano-code 插件引导模板

## 使用方式

1. 用户向 AI 描述想要的插件功能
2. AI 读取本模板，根据需求创建对应的 guide 文件
3. AI 按 guide 分步执行（每阶段一个文件，逐步加载）
4. 完成后产出：插件代码 + profile 配置

## Guide 文件结构

```
plugin-guides/{插件名}/
  manifest.json              — 元数据
  01-define-role.md          — 阶段 1: 定义角色
  02-code-plugin.md          — 阶段 2: 创建插件
  03-configure-profile.md    — 阶段 3: 配置 profile
  04-verify.md               — 阶段 4: 验证
```

## 各阶段说明

### Phase 1: 定义角色 (01-define-role.md)

**目标**：明确 AI 角色的身份、语气、行为边界。

**需要回答的问题**：
- 这个 agent 是什么角色？（树洞 / 代码助手 / 翻译 / 导师...）
- 它的核心行为原则是什么？（倾听 / 高效 / 精确...）
- 它需要哪些工具？不需要哪些工具？
- 它的启动问候语应该是什么？

### Phase 2: 创建插件 (02-code-plugin.md)

**目标**：编写实现角色所需能力的插件代码。

**插件类型选择**：

| 类型 | 适用场景 | 实现方式 |
|---|---|---|
| builtin | 需要新工具函数 | 创建 `src/plugins/tools/*.ts`，实现 `NanoPlugin` 接口 |
| hooks-only | 只需拦截消息，不需新工具 | 实现 `NanoPlugin` 但不提供 `getTools()` |
| MCP | 需连接外部服务 | 在 config 中配置 type: 'mcp' |
| npm | 需加载第三方包 | 配置 type: 'npm' |

**NanoPlugin 接口要点**：
```typescript
interface NanoPlugin {
  name: string;
  getTools(): ToolDefinition[];           // 工具定义
  execute(name, args, ctx): Promise<ToolResponse>;  // 工具执行
  onInit?(registry): Promise<void>;       // 初始化钩子
  onDestroy?(): Promise<void>;            // 销毁钩子
  onSystemPrompt?(prompt): string;        // 修改系统提示词
  onBeforeRequest?(messages): ChatMessage[];  // 请求前拦截
  onAfterRequest?(response): void;            // 响应后处理
  onBeforeToolCall?(call): ToolCall | null;   // 工具调用前拦截
  onAfterToolCall?(result): ToolResponse;     // 工具调用后处理
}
```

### Phase 3: 配置 Profile (03-configure-profile.md)

**目标**：创建 agent profile JSON，使角色可直接启动。

**Profile 格式**：
```json
{
  "agent": {
    "role": "角色描述（用于系统提示词）",
    "greeting": "启动时显示的问候语"
  },
  "plugins": {
    "插件名": {
      "type": "builtin | mcp | npm",
      "enabled": true,
      "settings": { ... }
    }
  }
}
```

**关键模式**：
- 启用所需插件，禁用不需要的默认插件（`"enabled": false`）
- 通过 `settings` 传递插件配置

### Phase 4: 验证 (04-verify.md)

**目标**：端到端验证插件正常工作。

**通用验证步骤**：
1. `npm run build` — TypeScript 编译
2. `nano-code --profile <name>` — 启动验证
3. 验证角色问候语正确
4. 验证工具集合正确（有/无哪些工具）
5. 验证跨会话持久化（如需）

## 通用操作 → 工具映射

Guide 文件使用平台无关的描述。AI 工具自行映射：

| Guide 写法 | 含义 | 常见工具映射 |
|---|---|---|
| "创建文件 `path`，内容..." | 写入文件 | Write / write_file_content / edit |
| "修改文件，将 X 替换为 Y" | 精确替换 | Edit / patch_file |
| "运行 `command`" | 执行命令 | Bash / run_bash_command |
| "读取 `path` 的内容" | 查看文件 | Read / view_file_content |
| "在 X 后插入 Y" | 插入内容 | Edit / patch_file |

## 注意事项

1. **分步加载**：每阶段完成后加载下一个 guide 文件，避免上下文溢出
2. **平台无关**：不假设 AI 工具的具体名称，使用通用指令
3. **可验证**：每阶段结束时都有明确的验证方法
4. **安全**：非必要不给文件系统/命令执行权限
