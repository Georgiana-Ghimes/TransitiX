import { describe, expect, it } from 'vitest';
import { MODULE_FLAGS, defaultModulesForProfile, normalizeFlags, profileLabel } from './platformFlags.js';

describe('platformFlags', () => {
  it('defaults full profile modules on', () => {
    const f = normalizeFlags({});
    expect(f.app_profile).toBe('full');
    expect(f.modules.dispatch).toBe(true);
    expect(f.modules.avize).toBe(true);
    expect(Object.keys(f.modules).sort()).toEqual(MODULE_FLAGS.map((m) => m.key).sort());
    expect(profileLabel(f)).toBe('TMS full');
  });

  it('documents profile keeps full catalog with TMS modules off', () => {
    const f = normalizeFlags({ app_profile: 'documents' });
    expect(f.app_profile).toBe('documents');
    expect(f.modules.avize).toBe(true);
    expect(f.modules.reports).toBe(true);
    expect(f.modules.driver_upload).toBe(true);
    expect(f.modules.dispatch).toBe(false);
    expect(f.modules.gps).toBe(false);
    expect(f.modules.commercial).toBe(false);
    expect(Object.keys(f.modules)).toHaveLength(MODULE_FLAGS.length);
    expect(profileLabel(f)).toBe('Companion documente');
  });

  it('preserves explicit overrides on documents', () => {
    const f = normalizeFlags({
      app_profile: 'documents',
      modules: { avize: false, dispatch: true },
    });
    expect(f.modules.avize).toBe(false);
    expect(f.modules.dispatch).toBe(true);
    expect(f.modules.fleet).toBe(false);
  });

  it('defaultModulesForProfile matches normalize empty', () => {
    expect(defaultModulesForProfile('documents')).toEqual(normalizeFlags({ app_profile: 'documents' }).modules);
  });
});
