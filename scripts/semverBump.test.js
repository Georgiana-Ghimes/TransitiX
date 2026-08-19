import { describe, expect, it } from 'vitest';
import { bumpSemver, classifyBump, highestBump, shouldSkipVersion } from './semverBump.js';

describe('semverBump', () => {
  it('classifies conventional commits', () => {
    expect(classifyBump('feat: add version badge')).toBe('minor');
    expect(classifyBump('feat(ui): sidebar version')).toBe('minor');
    expect(classifyBump('fix: login redirect')).toBe('patch');
    expect(classifyBump('docs: changelog')).toBe('patch');
    expect(classifyBump('feat!: new auth contract')).toBe('major');
    expect(classifyBump('fix: token\n\nBREAKING CHANGE: JWT payload')).toBe('major');
  });

  it('skips explicit version-bump commits', () => {
    expect(shouldSkipVersion('chore: bump version to 1.3.2')).toBe(true);
    expect(classifyBump('fix: foo [skip version]')).toBe(null);
  });

  it('takes the highest bump in a batch', () => {
    expect(highestBump(['docs: nits', 'feat: search'])).toBe('minor');
    expect(highestBump(['fix: a', 'feat!: b'])).toBe('major');
  });

  it('bumps semver parts', () => {
    expect(bumpSemver('1.3.1', 'patch')).toBe('1.3.2');
    expect(bumpSemver('1.3.1', 'minor')).toBe('1.4.0');
    expect(bumpSemver('1.3.1', 'major')).toBe('2.0.0');
    expect(bumpSemver('v1.3.1', 'patch')).toBe('1.3.2');
  });
});
