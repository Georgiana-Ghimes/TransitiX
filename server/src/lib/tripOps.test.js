import { describe, expect, it } from 'vitest';
import { normalizeUitCode, tripMargin } from './tripOps.js';

describe('normalizeUitCode', () => {
  it('accepts compact alphanumerics and strips dashes', () => {
    expect(normalizeUitCode('ro12-3456-7890abcd').value).toBe('RO1234567890ABCD');
    expect(normalizeUitCode('').value).toBeNull();
  });

  it('rejects short or punctuated codes', () => {
    expect(normalizeUitCode('ABC').error).toMatch(/invalid/i);
    expect(normalizeUitCode('UIT CODE!!').error).toBeTruthy();
  });
});

describe('tripMargin', () => {
  it('returns revenue minus cost when both are numbers', () => {
    expect(tripMargin(1000, 400)).toBe(600);
    expect(tripMargin('10.125', '0.12')).toBe(10.01);
    expect(tripMargin(100, null)).toBeNull();
  });
});
