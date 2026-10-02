import { describe, expect, it, afterEach, vi } from 'vitest';
import { runMistralOcr } from './mistralOcr.js';

describe('runMistralOcr timeout budget', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('honours a short timeoutMs instead of flooring at 5s', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    process.env.MISTRAL_API_BASE = 'http://127.0.0.1:9';

    const started = Date.now();
    vi.stubGlobal('fetch', (_url, opts) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        reject(err);
      };
      if (opts?.signal?.aborted) return onAbort();
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
    }));

    const result = await runMistralOcr(Buffer.from('x'), 'image/jpeg', { timeoutMs: 80 });
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(result.reason).toBe('mistral_timeout');
    // Must finish well under the old 5s floor; leave headroom for slow CI.
    expect(elapsed).toBeLessThan(1500);
  });
});
