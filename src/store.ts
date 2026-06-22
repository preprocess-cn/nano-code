/**
 * Store 接口：插件间共享状态通道。
 * 核心只约定接口，不知晓任何 key 的业务含义。
 * 谁 set 谁定义 key 名和值结构，谁 subscribe/get 谁理解 key 名含义。
 */
export interface IStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: unknown): void;
  subscribe(key: string, fn: () => void): () => void;
}
