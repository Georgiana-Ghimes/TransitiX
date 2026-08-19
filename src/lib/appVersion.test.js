import { describe, expect, it } from 'vitest';
import { APP_VERSION, formatAppVersion } from './appVersion.js';

describe('formatAppVersion', () => {
  it('uses the package.json version in the UI', () => {
    expect(formatAppVersion()).toBe(`v${APP_VERSION}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prefixes semver with v', () => {
    expect(formatAppVersion('1.3.2')).toBe('v1.3.2');
  });

  it('does not double the v prefix', () => {
    expect(formatAppVersion('v1.3.2')).toBe('v1.3.2');
  });
});
