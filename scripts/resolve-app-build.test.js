import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  resolveAppBuild,
  resolveAppProfile,
  resolveAppTitle,
  resolveAppVersion,
} from './resolve-app-build.js';

const env = { ...process.env };

afterEach(() => { process.env = { ...env }; });

beforeEach(() => {
  delete process.env.VITE_APP_PROFILE;
  delete process.env.VITE_APP_TITLE;
  delete process.env.VITE_APP_VERSION;
  delete process.env.VITE_APP_BUILD;
});

describe('resolveAppProfile', () => {
  /**
   * This shipped the wrong product once: `--mode companion` with no .env.companion built the
   * full Transitix app, and nothing failed.
   */
  it('derives the companion profile from the build mode alone', () => {
    expect(resolveAppProfile('companion')).toBe('documents');
  });

  it('leaves every other mode on the full app', () => {
    expect(resolveAppProfile('production')).toBe('full');
    expect(resolveAppProfile('development')).toBe('full');
    expect(resolveAppProfile(undefined)).toBe('full');
  });

  it('lets the environment override, for a one-off build', () => {
    process.env.VITE_APP_PROFILE = 'documents';
    expect(resolveAppProfile('production')).toBe('documents');
    process.env.VITE_APP_PROFILE = 'full';
    expect(resolveAppProfile('companion')).toBe('full');
  });

  it('treats an unknown profile name as the full app rather than guessing', () => {
    process.env.VITE_APP_PROFILE = 'altceva';
    expect(resolveAppProfile('companion')).toBe('full');
  });
});

describe('companion numbering', () => {
  it('keeps the product and the companion on separate version lines', () => {
    expect(resolveAppVersion('companion')).not.toBe(resolveAppVersion('production'));
    expect(resolveAppVersion('production')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the customer only for the companion', () => {
    expect(resolveAppTitle('companion')).toBeTruthy();
    expect(resolveAppTitle('production')).toBe('');
  });

  it('lets the environment pin a version and a build', () => {
    process.env.VITE_APP_VERSION = '9.9.9';
    process.env.VITE_APP_BUILD = '42';
    expect(resolveAppVersion('companion')).toBe('9.9.9');
    expect(resolveAppBuild('production')).toBe('42');
  });
});
