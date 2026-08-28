import { describe, expect, it } from 'vitest';
import { APP_BUILD, APP_VERSION, formatAppVersion } from './appVersion.js';

describe('formatAppVersion', () => {
  it('uses the package.json version and build in the UI', () => {
    expect(formatAppVersion()).toBe(`v${APP_VERSION} - ${APP_BUILD}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_BUILD.length).toBeGreaterThan(0);
  });

  it('prefixes semver with v', () => {
    expect(formatAppVersion('1.3.2', { withBuild: false })).toBe('v1.3.2');
    expect(formatAppVersion('1.3.2')).toBe(`v1.3.2 - ${APP_BUILD}`);
  });

  it('does not double the v prefix', () => {
    expect(formatAppVersion('v1.3.2', { withBuild: false })).toBe('v1.3.2');
  });
});
