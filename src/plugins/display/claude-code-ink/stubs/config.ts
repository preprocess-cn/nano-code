export function getGlobalConfig<T = Record<string, unknown>>(): T {
  return {} as T;
}

export async function saveGlobalConfig(_config: Record<string, unknown>): Promise<void> {
  // no-op in nano-code
}
