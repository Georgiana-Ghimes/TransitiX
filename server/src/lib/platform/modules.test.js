import { describe, expect, it } from 'vitest';
import { API_MODULE_BY_MOUNT, ENTITY_MODULE, isCompanyModuleEnabled } from './modules.js';

describe('platform modules (OCR vs documents_expiry)', () => {
  // #112 — companion RAI has documents_expiry off; OCR HITL must stay on avize.
  it('maps /api/documents and DocumentBatch to avize, not documents_expiry', () => {
    expect(API_MODULE_BY_MOUNT['/api/documents']).toBe('avize');
    expect(ENTITY_MODULE.DocumentBatch).toBe('avize');
    expect(ENTITY_MODULE.DocumentEvent).toBe('avize');
  });

  it('allows avize for a documents-profile company with documents_expiry off', () => {
    const flags = {
      app_profile: 'documents',
      modules: { avize: true, documents_expiry: false },
    };
    expect(isCompanyModuleEnabled(flags, 'avize')).toBe(true);
    expect(isCompanyModuleEnabled(flags, 'documents_expiry')).toBe(false);
  });
});
