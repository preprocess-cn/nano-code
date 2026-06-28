/**
 * Store 接口：插件间共享状态通道。
 * 核心只约定接口，不知晓任何 key 的业务含义。
 * 谁 set 谁定义 key 名和值结构，谁 subscribe/get 谁理解 key 名含义。
 *
 * InMemoryStore 是默认实现，直接使用 Map 存储。
 */
export interface IStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, fn: () => void): () => void;
}

export class InMemoryStore implements IStore {
  private state = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();

  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
    this.listeners.get(key)?.forEach(fn => fn());
  }

  subscribe(key: string, fn: () => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }
}
