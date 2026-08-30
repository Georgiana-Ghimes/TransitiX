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
    expect(isOfficeRole('platform_admin')).toBe(false);
  });

  it('detects platform admin and sends them to /platform', async () => {
    const { isPlatformAdmin, homePathForRole, postLoginPath } = await loadRoles();
    expect(isPlatformAdmin('platform_admin')).toBe(true);
    expect(isPlatformAdmin({ role: 'admin' })).toBe(false);
    expect(homePathForRole('platform_admin')).toBe('/platform');
    expect(postLoginPath('platform_admin', '/avize')).toBe('/platform');
    expect(postLoginPath('platform_admin', '/platform/companies')).toBe('/platform/companies');
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

  it('documents profile lands office users on avize with slug', async () => {
    vi.stubEnv('VITE_APP_PROFILE', 'documents');
    const { homePathForRole, postLoginPath } = await loadRoles();
    expect(homePathForRole('admin')).toBe('/avize');
    expect(postLoginPath('admin', '/trips')).toBe('/avize');
    expect(postLoginPath('admin', '/reports')).toBe('/reports');
    expect(postLoginPath('driver', '/avize')).toBe('/driver-app');
    const rai = {
      role: 'admin',
      company: {
        slug: 'raidocs4n9p',
        feature_flags: { app_profile: 'documents', modules: { trips: true, avize: true, reports: true } },
      },
    };
    expect(postLoginPath(rai, '/trips')).toBe('/raidocs4n9p/trips');
    expect(postLoginPath(rai, '/')).toBe('/raidocs4n9p/avize');
  });
});
