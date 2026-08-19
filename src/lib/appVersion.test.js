import { describe, expect, it } from 'vitest';
import { formatAppVersion } from './appVersion.js';

describe('formatAppVersion', () => {
  it('prefixes semver with v', () => {
    expect(formatAppVersion('1.3.2')).toBe('v1.3.2');
  });

  it('does not double the v prefix', () => {
    expect(formatAppVersion('v1.3.2')).toBe('v1.3.2');
  });
});
