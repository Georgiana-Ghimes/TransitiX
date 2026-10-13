import { describe, expect, it } from 'vitest';
import { shouldReloadForCompanionBuild } from './appBuildWatch.js';

describe('shouldReloadForCompanionBuild', () => {
  it('does nothing without companion meta or on network-shaped empties', () => {
    expect(shouldReloadForCompanionBuild(null, '105')).toBe(false);
    expect(shouldReloadForCompanionBuild({}, '105')).toBe(false);
    expect(shouldReloadForCompanionBuild({ companion: {} }, '105')).toBe(false);
    expect(shouldReloadForCompanionBuild({ companion: { build: '' } }, '105')).toBe(false);
  });

  it('does nothing when builds match', () => {
    expect(shouldReloadForCompanionBuild(
      { companion: { version: '1.25.5', build: '105' } },
      '105',
    )).toBe(false);
    expect(shouldReloadForCompanionBuild(
      { companion: { build: 105 } },
      '105',
    )).toBe(false);
  });

  it('reloads when the server build is ahead', () => {
    expect(shouldReloadForCompanionBuild(
      { companion: { version: '1.25.6', build: '106' } },
      '105',
    )).toBe(true);
  });

  it('skips local/dev baked builds so vite --mode companion is not looping', () => {
    expect(shouldReloadForCompanionBuild(
      { companion: { build: '106' } },
      'dev',
    )).toBe(false);
    expect(shouldReloadForCompanionBuild(
      { companion: { build: '106' } },
      '',
    )).toBe(false);
  });
});
