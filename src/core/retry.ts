export interface RetryOptions {
  maxRetries: number;
  delaysMs: number[];
  label: string;
  isTransient: (err: unknown) => boolean;
}

/**
 * Generic retry loop with exponential backoff.
 * Throws the last error if all retries are exhausted or the error is non-transient.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < options.maxRetries && options.isTransient(err)) {
        const delay = options.delaysMs[attempt];
        console.warn(`[${options.label}] retry ${attempt + 1}/${options.maxRetries + 1} (delay ${delay / 1000}s)`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
