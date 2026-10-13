import { describe, expect, it } from 'vitest';
import { prefetchPath } from './routePrefetch.js';

describe('routePrefetch', () => {
  it('prefetchPath is a no-op for unknown routes', () => {
    expect(() => prefetchPath('/not-a-real-page')).not.toThrow();
    expect(() => prefetchPath('')).not.toThrow();
    expect(() => prefetchPath(null)).not.toThrow();
  });
});
