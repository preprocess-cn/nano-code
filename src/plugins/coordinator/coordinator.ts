import { NanoPlugin, PluginRegistry } from '#src/core/plugin.js';
import { ToolResponse, ToolContext, ToolDefinition, type AgentDisplay } from '#src/core/contract.js';
import { LLMClient, ChatMessage } from '#src/core/llm.js';
import { AgentManager } from '#src/core/agent-manager.js';
import { loadAgentDefinitions, AgentDefinition } from '#src/plugins/coordinator/agent-loader.js';
import { createAgentToolPlugin } from '#src/plugins/coordinator/agent-tool.js';
import { MessageBus } from '#src/plugins/coordinator/message-bus.js';
import { validateSendMessageArgs } from '#src/plugins/coordinator/messaging-plugins.js';
import { EXPLORE_AGENT_DEF, EXPLORE_AGENT_NAME } from '#src/plugins/explore/explore-definition.js';
import { GENERAL_PURPOSE_AGENT_DEF } from '#src/plugins/coordinator/general-purpose-definition.js';
import { createFilteredPlugin, createReadonlyCommandPlugin } from '#src/plugins/explore/tool-utils.js';

export function createAgentCoordinatorPlugin(
  llmClient: LLMClient,
  displayMgr?: AgentDisplay,
  agentManager?: AgentManager,
  agentDirs?: string[],
): NanoPlugin {
  const yamlDefs = loadAgentDefinitions(agentDirs).filter((d) => d.enabled !== false);

  // Merge built-in agents (Explore) with YAML-defined agents.
  // Built-in agents are always available even when ~/.nano-code/agents/ is empty.
  const defs = [EXPLORE_AGENT_DEF, GENERAL_PURPOSE_AGENT_DEF, ...yamlDefs];

  return {
    name: 'agent-coordinator',
    description: 'Multi-agent coordination — sub-agent execution and inter-agent messaging',

    getTools(): ToolDefinition[] {
      return [
        {
          type: 'function',
          function: {
            name: 'send_message',
            description: '发送消息给另一个正在运行的 agent。用于 agent 间协作——传递上下文、请求协助或通知结果。',
            parameters: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: '接收方，可以是 agent 名称（如 "dba"）或任务 ID（如 "task_3"）。',
                },
                summary: {
                  type: 'string',
                  description: '消息摘要（一行，10 词以内），收件人可见。',
                },
                message: {
                  type: 'string',
                  description: '消息正文。',
                },
              },
              required: ['to', 'summary', 'message'],
            },
            sideEffect: false,
          },
        },
      ];
    },

    async execute(
      name: string,
      args: any,
      _ctx: ToolContext,
    ): Promise<ToolResponse> {
      if (name === 'send_message') {
        const err = validateSendMessageArgs(args);
        if (err) return err;

        const { to, summary, message } = args || {};
        return MessageBus.getInstance().send('main', 'main', to, summary, message);
      }

      return { status: 'error', message: `未知工具: ${name}` };
    },

    async onInit(registry: PluginRegistry): Promise<void> {
      // Register main agent so other agents can send messages to it
      MessageBus.getInstance().registerAgent('main', 'main');

      for (const def of defs) {
        const isExplore = def.name === EXPLORE_AGENT_NAME;
        const plugin = createAgentToolPlugin(
          def, llmClient, displayMgr, agentManager,
          isExplore
            ? {
                pluginTransforms: {
                  fs: (p) => createFilteredPlugin(p, new Set(['list_project_files', 'view_file_content'])),
                  command: (p) => createReadonlyCommandPlugin(p),
                },
              }
            : undefined,
        );
        await registry.register(plugin);
      }
    },

    onSystemPrompt(prompt: string): string {
      let result = prompt;

      if (defs.length > 0) {
        const entries = defs
          .map(
            (d) =>
              `- agent-${d.name}: ${d.description} — 使用 agent-${d.name}({ query }) 调用`,
          )
          .join('\n');
        result += `\n\n## Specialist Agents\n你可以将任务委托给以下 specialist agent：\n${entries}\n\n### 使用方式\n- 调用 agent 后会同步执行，等待子 agent 返回结果后再继续\n- 可以同时启动多个 agent（先启动所有 agent，等待它们完成）\n\n### Agent 间通信\n- 使用 send_message({to, summary, message}) 发送消息给其他 agent\n- to 可以是 agent 名称（如 "dba"）或任务 ID（如 "task_3"）\n- 运行中的 agent 也可以回复你`;
      }

      return result;
    },

    onBeforeRequest(messages: ChatMessage[]): ChatMessage[] {
      const extraMessages: string[] = [];

      // Messages from other agents for the main agent
      const bus = MessageBus.getInstance();
      const mainMessages = bus.receiveUpTo('main', 5); // Cap at 5 per design constraints
      if (mainMessages.length > 0) {
        const formatted = mainMessages
          .map(
            (m) =>
              `[来自 ${m.fromAgentName}: ${m.summary}]\n${m.content}`,
          )
          .join('\n\n---\n\n');
        extraMessages.push(`## agent 发来的消息\n\n你收到了来自其他 agent 的消息:\n\n${formatted}`);
      }

      if (extraMessages.length === 0) return messages;

      const [system, ...rest] = messages;
      return [
        system,
        ...extraMessages.map((content) => ({
          role: 'user' as const,
          content,
        })),
        ...rest,
      ];
    },
  };
}
