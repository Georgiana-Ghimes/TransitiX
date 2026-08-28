import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

async function loadRoles() {
  return import('./roles.js');
}

describe('roles', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_APP_PROFILE', 'full');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects driver role from user object or string', async () => {
    const { isDriverRole } = await loadRoles();
    expect(isDriverRole('driver')).toBe(true);
    expect(isDriverRole({ role: 'driver' })).toBe(true);
    expect(isDriverRole('admin')).toBe(false);
  });

  it('detects office roles', async () => {
    const { isOfficeRole } = await loadRoles();
    expect(isOfficeRole('admin')).toBe(true);
    expect(isOfficeRole('dispatcher')).toBe(true);
    expect(isOfficeRole('finance')).toBe(true);
    expect(isOfficeRole('driver')).toBe(false);
  });

  it('sends drivers to driver app home', async () => {
    const { homePathForRole } = await loadRoles();
    expect(homePathForRole('driver')).toBe('/driver-app');
    expect(homePathForRole('admin')).toBe('/');
  });

  it('postLoginPath honors returnTo for office users', async () => {
    const { postLoginPath } = await loadRoles();
    expect(postLoginPath('admin', '/trips')).toBe('/trips');
    expect(postLoginPath('admin', '/driver-app')).toBe('/');
    expect(postLoginPath('driver', '/trips')).toBe('/driver-app');
  });

  it('documents profile lands office users on avize', async () => {
    vi.stubEnv('VITE_APP_PROFILE', 'documents');
    const { homePathForRole, postLoginPath } = await loadRoles();
    expect(homePathForRole('admin')).toBe('/avize');
    expect(postLoginPath('admin', '/trips')).toBe('/avize');
    expect(postLoginPath('admin', '/reports')).toBe('/reports');
    expect(postLoginPath('driver', '/avize')).toBe('/driver-app');
  });
});
