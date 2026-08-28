import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('appProfile', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to full profile', async () => {
    vi.stubEnv('VITE_APP_PROFILE', '');
    const { isDocumentsProfile } = await import('./appProfile.js');
    expect(isDocumentsProfile()).toBe(false);
  });

  it('detects documents companion profile', async () => {
    vi.stubEnv('VITE_APP_PROFILE', 'documents');
    const { isDocumentsProfile, isCompanionOfficePath } = await import('./appProfile.js');
    expect(isDocumentsProfile()).toBe(true);
    expect(isCompanionOfficePath('/avize')).toBe(true);
    expect(isCompanionOfficePath('/reports/export')).toBe(true);
    expect(isCompanionOfficePath('/trips')).toBe(false);
  });

  it('companionTagline defaults for documents profile', async () => {
    vi.stubEnv('VITE_APP_TAGLINE', '');
    const { companionTagline } = await import('./appProfile.js');
    expect(companionTagline()).toBe('Companionul tău pentru documente');
  });
});
