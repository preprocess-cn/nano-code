---
phase: 3
name: configure
next: plugin-guides/treehole/04-verify.md
---

# 阶段 3：配置 Agent Profile

## 目标

为树洞角色创建 agent profile 配置文件，让 nano-code 可以通过 `--profile treehole` 直接启动为树洞模式。

## 背景信息

nano-code 支持使用 `--profile <name>` CLI 参数加载角色配置文件。Profile 文件的搜索顺序：

1. 项目目录 `.nano-code/profiles/<name>.json`（优先级高）
2. 全局目录 `~/.nano-code/profiles/<name>.json`（优先级低）

Profile 可以覆盖所有 `config.json` 字段，包括 `agent`、`plugins` 等，且拥有最高优先级。

## 操作步骤

### Step 1: 创建 Profile 文件

创建 `~/.nano-code/profiles/treehole.json`，内容如下：

```json
{
  "agent": {
    "role": "一个善解人意的树洞，温柔地倾听用户的心声",
    "greeting": "你好，我是树洞。你可以放心地说任何事情，我都会认真倾听，不会评判你。"
  },
  "plugins": {
    "memory": {
      "type": "builtin",
      "enabled": true,
      "settings": {
        "namespace": "treehole",
        "maxMemories": 500,
        "recallLimit": 15
      }
    },
    "fs": {
      "enabled": false
    },
    "command": {
      "enabled": false
    }
  }
}
```

### Step 2: 确保 Profile 加载逻辑工作

验证 `src/config.ts` 中的 `loadConfig(profileName)` 正确支持 profile 合并：

1. 加载全局配置 `~/.nano-code/config.json`
2. 加载项目配置 `$CWD/.nano-code.json`
3. 加载 profile 配置（优先级最高）
4. 通过 `mergeConfigs` 进行深层合并

### Step 3: 确保 CLI 支持 --profile

验证 `src/index.ts` 包含：

```
cli.option('-p, --profile <name>', '指定 agent 角色配置文件（profile）...');
```

并且 `startCLI()` 将 `options.profile` 传递给 `loadConfig()`。

## 产出物清单

- `~/.nano-code/profiles/treehole.json` — 树洞角色的配置
- `.nano-code/profiles/treehole.json`（可选）— 项目级覆盖

## 验证方法

- 确认 profile 文件存在且 JSON 格式正确
- 确认 `fs` 和 `command` 插件被禁用（`"enabled": false`）
- 确认 `memory` 插件已启用且 `namespace` 为 "treehole"
