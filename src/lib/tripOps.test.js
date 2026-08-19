import { describe, expect, it } from 'vitest';
import { formatRon, tripMargin } from './tripOps.js';

describe('tripMargin', () => {
  it('rounds to cents', () => {
    expect(tripMargin(100, 33.333)).toBe(66.67);
    expect(tripMargin('', 10)).toBeNull();
  });
});

describe('formatRon', () => {
  it('formats RON or em dash', () => {
    expect(formatRon(null)).toBe('—');
    expect(formatRon(1200)).toMatch(/1.?200/);
  });
});
