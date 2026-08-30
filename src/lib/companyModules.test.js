import { describe, expect, it } from 'vitest';
import { isModuleEnabled, isPathAllowedForCompany, moduleForPath } from './companyModules.js';

describe('companyModules', () => {
  const raiUser = {
    role: 'admin',
    company: {
      feature_flags: {
        app_profile: 'documents',
        modules: { avize: true, reports: true, dispatch: false, gps: false },
      },
    },
  };

  it('maps paths to modules', () => {
    expect(moduleForPath('/dispatch')).toBe('dispatch');
    expect(moduleForPath('/trips/abc')).toBe('trips');
    expect(moduleForPath('/settings')).toBe(null);
  });

  it('hides disabled modules for tenant users', () => {
    expect(isModuleEnabled(raiUser, 'avize')).toBe(true);
    expect(isModuleEnabled(raiUser, 'dispatch')).toBe(false);
    expect(isPathAllowedForCompany(raiUser, '/avize')).toBe(true);
    expect(isPathAllowedForCompany(raiUser, '/gps')).toBe(false);
  });

  it('platform admin bypasses module gates', () => {
    expect(isModuleEnabled({ role: 'platform_admin' }, 'dispatch')).toBe(true);
  });
});
