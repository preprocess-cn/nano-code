---
phase: 2
name: create-plugin
next: plugin-guides/treehole/03-configure-profile.md
---

# 阶段 2：创建 Memory 插件

## 目标

创建提供记忆存储和检索功能的内置插件，供树洞使用。

## 背景信息

nano-code 使用 `NanoPlugin` 接口定义插件。插件可以：
- 提供工具（`getTools()` / `execute()`）
- 注册生命周期钩子（`onInit` / `onDestroy`）
- 拦截消息（`onBeforeRequest` / `onAfterRequest`）

现有内置插件位于 `src/plugins/tools/` 目录，可作为参考：
- `fs.ts` — 文件读写工具
- `command.ts` — 命令执行工具

## 操作步骤

### Step 1: 创建插件文件

在 `src/plugins/tools/memory.ts` 创建新文件，内容应包括：

- 使用 `~/.nano-code/memory/{namespace}/` 作为存储目录
- 提供两个工具：
  - `save_memory(content, tags?)` — 保存记忆（sideEffect: true）
  - `recall_memory(query, limit?)` — 检索记忆（sideEffect: false）
- 实现 `NanoPlugin` 接口：
  - `name: 'memory'`
  - `getTools()` 返回工具定义
  - `execute(name, args, ctx)` 处理工具调用
  - `onInit(registry)` 从 registry 读取配置

### Step 2: 注册到启动流程

在 `src/index.ts` 中：

1. 导入 `createMemoryPlugin` 工厂函数
2. 在注册 token-budget 插件的代码块后添加 memory 插件的注册代码
3. 使用 `config.plugins['memory']` 的配置初始化

参考 token-budget 的注册模式：

```typescript
// Register memory plugin if configured
if (config.plugins['memory']) {
  const memoryConfig = config.plugins['memory'].settings || {};
  await registry.register(createMemoryPlugin(memoryConfig));
}
```

### Step 3: 更新系统提示词

修改 `src/prompt.ts`，将 `buildRoleLine` 改为根据实际注册的工具列表动态生成描述：

```typescript
// 旧：硬编码文件操作描述
// 新：动态生成 "你可以调用以下工具：xxx、yyy"
const toolNames = tools.map(t => t.function.name);
const toolDesc = toolNames.join('、');
```

### Step 4: 编译验证

运行 `npm run build`，确保 TypeScript 编译通过。

## 产出物清单

- `src/plugins/tools/memory.ts` — Memory 插件源文件
- `src/index.ts` — 修改后的入口文件（增加 memory 注册）
- `src/prompt.ts` — 修改后的系统提示词生成（动态工具描述）

## 验证方法

- `npm run build` 编译无错误
- 启动 nano-code 后，确认 `save_memory` 和 `recall_memory` 工具可用
