import { IStore } from '../../store.js';

type Listener = () => void;

/**
 * 默认内存 Store 实现。
 * 直接使用 Map 存储，同步通知订阅者。
 */
export class InMemoryStore implements IStore {
  private state = new Map<string, unknown>();
  private listeners = new Map<string, Set<Listener>>();

  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
    this.listeners.get(key)?.forEach(fn => fn());
  }

  subscribe(key: string, fn: Listener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(fn);
    return () => this.listeners.get(key)?.delete(fn);
  }
}
