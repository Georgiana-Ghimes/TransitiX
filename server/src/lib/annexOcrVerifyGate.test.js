import { describe, expect, it } from 'vitest';
import { docsUnackedLowTpo, refuseAnnexIfUnackedLowTpo } from './annexOcrVerifyGate.js';

describe('annexOcrVerifyGate', () => {
  it('lists unacked low TPO docs and skips confirmed / corrected', () => {
    expect(docsUnackedLowTpo([
      { id: 'a', status: 'extracted', numar_tpo: 'TPO-1', field_confidence: { numar_tpo: 'low' } },
      { id: 'b', status: 'confirmed', numar_tpo: 'TPO-2', field_confidence: { numar_tpo: 'low' } },
      { id: 'c', status: 'extracted', numar_tpo: 'TPO-3', field_confidence: { numar_tpo: 'low' }, corrected_fields: ['numar_tpo'] },
      { id: 'd', status: 'extracted', numar_tpo: 'TPO-4', field_confidence: { numar_tpo: 'ok' } },
    ]).map((d) => d.id)).toEqual(['a']);
  });

  it('refuses annex when low TPO is unacked — even conceptually with allow_unconfirmed', () => {
    try {
      refuseAnnexIfUnackedLowTpo([
        { id: 'ok', status: 'extracted', numar_tpo: 'TPO-1', field_confidence: { numar_tpo: 'ok' } },
        {
          id: 'low',
          status: 'extracted',
          numar_tpo: 'TPO-0033600',
          original_filename: 'stamp.pdf',
          field_confidence: { numar_tpo: 'low' },
        },
      ]);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('OCR_VERIFY_REQUIRED');
      expect(err.message).toMatch(/OCR nesigur|verifică/i);
      expect(err.blocked).toEqual([
        { id: 'low', filename: 'stamp.pdf', numar_tpo: 'TPO-0033600' },
      ]);
    }
  });

  it('allows annex when low TPO was corrected', () => {
    expect(() => refuseAnnexIfUnackedLowTpo([
      {
        id: 'a',
        status: 'extracted',
        numar_tpo: 'TPO-0033600',
        field_confidence: { numar_tpo: 'low' },
        corrected_fields: ['numar_tpo'],
      },
    ])).not.toThrow();
  });

  it('treats object-shaped field_confidence review/missing as low', () => {
    expect(docsUnackedLowTpo([
      {
        id: 'obj',
        status: 'extracted',
        numar_tpo: 'TPO-1',
        field_confidence: { numar_tpo: { status: 'review', confidence: 0.4 } },
      },
      {
        id: 'ok',
        status: 'extracted',
        numar_tpo: 'TPO-2',
        field_confidence: { numar_tpo: { status: 'ok', confidence: 0.95 } },
      },
    ]).map((d) => d.id)).toEqual(['obj']);
  });
});
