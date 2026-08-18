import { describe, expect, it } from 'vitest';
import { pickCompanyWritable, publicCompany } from './company.js';

describe('pickCompanyWritable', () => {
  it('keeps company fields and drops unknown keys', () => {
    const out = pickCompanyWritable({
      name: 'RAI Spedition',
      cui: 'RO1',
      hacker: 'nope',
    });
    expect(out.name).toBe('RAI Spedition');
    expect(out.cui).toBe('RO1');
    expect(out.hacker).toBeUndefined();
  });

  it('serializes settings as jsonb string with defaults', () => {
    const out = pickCompanyWritable({
      settings: { document_expiry_days: [7, 1] },
    });
    const parsed = JSON.parse(out.settings);
    expect(parsed.document_expiry_days).toEqual([7, 1]);
  });
});

describe('publicCompany', () => {
  it('fills default expiry thresholds', () => {
    const company = publicCompany({
      id: 'c1',
      name: 'Demo',
      settings: {},
    });
    expect(company.settings.document_expiry_days).toEqual([30, 15, 7, 1]);
  });
});
