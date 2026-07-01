import { ToolResponse } from '../../core/contract.js';

export interface AgentMessage {
  from: string;
  fromAgentName: string;
  summary: string;
  content: string;
  timestamp: Date;
}

export class MessageBus {
  private static instance: MessageBus;
  private mailboxes: Map<string, AgentMessage[]> = new Map();
  private agentRegistry: Map<string, string> = new Map(); // agentName → taskId
  private taskToName: Map<string, string> = new Map();    // taskId → agentName

  private constructor() {}

  static getInstance(): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus();
    }
    return MessageBus.instance;
  }

  static resetInstance(): void {
    MessageBus.instance = undefined as unknown as MessageBus;
  }

  /** Register a running agent so others can send messages to it */
  registerAgent(taskId: string, agentName: string): void {
    this.agentRegistry.set(agentName, taskId);
    this.taskToName.set(taskId, agentName);
  }

  /** Unregister a completed or cancelled agent */
  unregisterAgent(taskId: string): void {
    const name = this.taskToName.get(taskId);
    if (name) {
      this.agentRegistry.delete(name);
      this.taskToName.delete(taskId);
    }
    this.mailboxes.delete(taskId);
  }

  /** Resolve a recipient identifier (agent name or taskId) to taskId */
  resolveRecipient(to: string): string | undefined {
    return this.agentRegistry.get(to) || (this.taskToName.has(to) ? to : undefined);
  }

  /** Send a message to a running agent. Returns error if agent not found. */
  send(
    from: string,
    fromAgentName: string,
    to: string,
    summary: string,
    content: string,
  ): ToolResponse {
    const targetTaskId = this.resolveRecipient(to);
    if (!targetTaskId) {
      return {
        status: 'error',
        message: `接收方 "${to}" 未找到或已结束。可用 agent_task_status 查看运行中的 agent。`,
      };
    }
    if (!this.mailboxes.has(targetTaskId)) {
      this.mailboxes.set(targetTaskId, []);
    }
    this.mailboxes.get(targetTaskId)!.push({
      from,
      fromAgentName,
      summary,
      content,
      timestamp: new Date(),
    });
    return {
      status: 'success',
      data: JSON.stringify({ message: `消息已发送给 ${to}` }),
    };
  }

  /** Drain and return all pending messages for a task */
  receive(taskId: string): AgentMessage[] {
    const msgs = this.mailboxes.get(taskId) ?? [];
    this.mailboxes.delete(taskId);
    return msgs;
  }

  /** View pending messages without draining */
  peek(taskId: string): AgentMessage[] {
    return this.mailboxes.get(taskId) ?? [];
  }

  /** Receive up to max messages, leaving the rest in the mailbox */
  receiveUpTo(taskId: string, max: number): AgentMessage[] {
    const all = this.mailboxes.get(taskId) ?? [];
    const take = all.slice(0, max);
    const rest = all.slice(max);
    if (rest.length > 0) {
      this.mailboxes.set(taskId, rest);
    } else {
      this.mailboxes.delete(taskId);
    }
    return take;
  }

  /** Get count of pending messages for a task */
  pendingCount(taskId: string): number {
    return this.mailboxes.get(taskId)?.length ?? 0;
  }
}
