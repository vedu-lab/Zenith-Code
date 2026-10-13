import { describe, it, expect } from 'vitest';
import { withRetry, isRetryableError, calculateBackoffWithJitter } from '../src/provider/retry.js';
import { ProviderError, ErrorCode } from '../src/errors/index.js';

describe('Provider Retry & Backoff', () => {
  it('should identify retryable errors', () => {
    expect(isRetryableError(new Error('Rate limit exceeded (429)'))).toBe(true);
    expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed: ECONNRESET'))).toBe(true);
    expect(isRetryableError(new ProviderError('openai', 'timeout', { isRetryable: true }))).toBe(
      true,
    );

    expect(isRetryableError(new Error('Invalid API key (401)'))).toBe(false);
    expect(
      isRetryableError(new ProviderError('anthropic', 'invalid request', { isRetryable: false })),
    ).toBe(false);
  });

  it('should compute exponential backoff with jitter within bounded range', () => {
    const delay0 = calculateBackoffWithJitter(0, 100, 1000);
    expect(delay0).toBeGreaterThanOrEqual(50);
    expect(delay0).toBeLessThanOrEqual(100);

    const delay2 = calculateBackoffWithJitter(2, 100, 1000);
    // 100 * 2^2 = 400. Jitter between 0.5 and 1.0 => [200, 400]
    expect(delay2).toBeGreaterThanOrEqual(200);
    expect(delay2).toBeLessThanOrEqual(400);
  });

  it('should retry transient errors until success', async () => {
    let attempts = 0;
    const operation = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('503 Service Unavailable');
      }
      return 'success';
    };

    const result = await withRetry(operation, {
      maxRetries: 4,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should not retry non-retryable errors', async () => {
    let attempts = 0;
    const operation = async () => {
      attempts++;
      throw new ProviderError('openai', 'Invalid authentication key', {
        code: ErrorCode.PROVIDER_AUTH_ERROR,
        isRetryable: false,
      });
    };

    await expect(withRetry(operation, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow(
      'Invalid authentication key',
    );
    expect(attempts).toBe(1);
  });
});
