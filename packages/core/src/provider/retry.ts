import { ProviderError } from '../errors/index.js';

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.isRetryable;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    ) {
      return true;
    }
  }
  return false;
}

export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  // Full jitter: uniformly distributed between 0.5 and 1.0 of exponential
  const jitterFactor = 0.5 + Math.random() * 0.5;
  return Math.floor(exponential * jitterFactor);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;

  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = calculateBackoffWithJitter(attempt - 1, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt, delayMs, error);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
