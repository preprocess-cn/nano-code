# nano-code

轻量级终端 AI 编程助手。通过自然语言与代码仓库交互——查看文件结构、读取代码、创建/修改文件、执行命令。

## 快速开始

```bash
# 安装依赖
npm install

# 配置 API Key（编辑 .env 文件）
# 支持 OpenAI / DeepSeek / Ollama 等任何兼容 API

# 直接运行（无需编译）
npx tsx src/index.ts

# 或编译后运行
npm run build
npm start
```

## 使用示例

```
$ npx tsx src/index.ts

! nano-code 终端 AI 编程助手 启动中...
----------------------------------------------------
 * 提示：我可以帮您查看项目结构、读取代码并直接修改。
 [!] 退出：输入 "exit"、"quit" 或直接按下 Ctrl+C 即可。
----------------------------------------------------

>> 请输入开发任务或指令：帮我看看项目里有哪些文件
>> 请输入开发任务或指令：读取 src/index.ts 看下入口逻辑
>> 请输入开发任务或指令：创建一个 utils.ts，写一个数组去重函数
>> 请输入开发任务或指令：运行测试
```

## 命令行选项

| 选项 | 说明 |
|---|---|
| `-d, --debug` | 开启调试模式，打印与 LLM 交互的完整数据包 |
| `-t, --think` | 显示 LLM 的思考过程（思维链） |
| `--help` | 显示帮助信息 |

## 配置

通过 `.env` 文件配置：

```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，默认 OpenAI
OPENAI_MODEL_NAME=gpt-4o                     # 可选，默认 gpt-4o
```

支持任何兼容 OpenAI API 格式的后端：DeepSeek、通义千问、Ollama 本地模型等。

## 功能

- **文件浏览** - 递归列出项目结构，读取任意文件内容（路径穿越防护）
- **文件创建/覆写** - 自动创建目录，写入前需人工确认
- **精准修改** - search-and-replace 模式，对已有文件做微创修改
- **命令执行** - 在终端执行 bash 命令（需人工确认）
- **安全防护** - 危险命令（rm -rf、dd、shutdown 等）自动拦截，路径穿越防护
- **流式响应** - LLM 流式输出实时展示，支持 `--think` 查看推理过程

## 测试

```bash
npm test
```

## 技术栈

TypeScript + Node.js 原生测试框架，通过 OpenAI 兼容 API 调用 LLM，使用 ReAct 循环模式驱动工具调用。
