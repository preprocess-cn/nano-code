import { NanoCodeAgent } from '#src/core/agent.js';
import { LLMClient, ChatMessage } from '#src/core/llm.js';
import { PluginRegistry } from '#src/core/plugin.js';
import { IStore, InMemoryStore } from '#src/core/store.js';
import { SK, agentStatusKey, agentAbortKey, agentMessagesKey, agentCancelledKey } from '#src/core/store-keys.js';
import { AgentInfo, CreateAgentOptions } from '#src/core/contract.js';

const DEFAULT_MAX_AGENTS = 10;

export class AgentManager {
  private agents = new Map<string, NanoCodeAgent>();
  private agentInfos = new Map<string, AgentInfo>();
  private llmClient: LLMClient;
  private _store: IStore;
  private maxAgents: number;

  constructor(options: { llmClient: LLMClient; store?: IStore; maxAgents?: number }) {
    this.llmClient = options.llmClient;
    this._store = options.store ?? new InMemoryStore();
    this.maxAgents = options.maxAgents ?? DEFAULT_MAX_AGENTS;

    // 自身注册到 store，供插件获取
    this._store.set(SK.AgentManager, this);
  }

  get activeCount(): number {
    return this.agents.size;
  }

  getStore(): IStore {
    return this._store;
  }

  getLLMClient(): LLMClient {
    return this.llmClient;
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agentInfos.values());
  }

  getAgent(name: string): NanoCodeAgent | undefined {
    return this.agents.get(name);
  }

  getAgentInfo(name: string): AgentInfo | undefined {
    return this.agentInfos.get(name);
  }

  /**
   * 创建 agent。同名时自动追加后缀 _1、_2… 保证内部唯一。
   * 超出 maxAgents 上限时抛异常。
   */
  createAgent(opts: CreateAgentOptions): NanoCodeAgent {
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Agent 数量已达上限 (${this.maxAgents})`);
    }

    // 重名处理：追加后缀
    let uniqueName = opts.name;
    if (this.agents.has(uniqueName)) {
      let counter = 1;
      while (this.agents.has(`${uniqueName}_${counter}`)) counter++;
      uniqueName = `${uniqueName}_${counter}`;
    }

    // 强制使用共享 store
    opts.registry.store = this._store;
    opts.registry.setAgentName(uniqueName);

    const agent = new NanoCodeAgent({
      registry: opts.registry,
      llmClient: this.llmClient,
      agentRole: opts.agentRole,
      promptConfig: opts.promptConfig,
      name: uniqueName,
      display: opts.display,
      abortController: opts.abortController,
    });

    this.agents.set(uniqueName, agent);
    this.agentInfos.set(uniqueName, {
      name: uniqueName,
      status: 'idle',
      messageCount: 0,
      role: opts.agentRole,
      createdAt: new Date().toISOString(),
    });

    // 写初始状态到 store
    this._updateAgentStore(uniqueName);

    return agent;
  }

  /**
   * 从注册表中移除 agent。子 agent 完成后应在 finally 中调用。
   */
  removeAgent(name: string): void {
    this.agents.delete(name);
    this.agentInfos.delete(name);

    // 清理 store 中该 agent 的状态键
    this._store.set(agentStatusKey(name), undefined);
    this._store.set(agentAbortKey(name), undefined);
    this._store.set(agentMessagesKey(name), undefined);
    this._store.set(agentCancelledKey(name), undefined);
  }

  /**
   * 终止 agent：发送取消信号 + 中止 LLM 请求。
   */
  killAgent(name: string): boolean {
    if (!this.agents.has(name)) return false;

    this._store.set(agentCancelledKey(name), true);
    const abortCtrl = this._store.get<AbortController>(agentAbortKey(name));
    if (abortCtrl && !abortCtrl.signal.aborted) {
      abortCtrl.abort();
    }
    return true;
  }

  /** 供 NanoCodeAgent 调用的状态更新入口 */
  updateAgentStatus(name: string, status: 'idle' | 'running', messageCount: number): void {
    const info = this.agentInfos.get(name);
    if (info) {
      info.status = status;
      info.messageCount = messageCount;
      this._updateAgentStore(name);
    }
  }

  /** 更新 agent 在共享 store 中的状态 */
  private _updateAgentStore(name: string): void {
    const info = this.agentInfos.get(name);
    if (!info) return;
    this._store.set(agentStatusKey(name), {
      agentName: name,
      status: info.status,
      messageCount: info.messageCount,
    });
  }
}
