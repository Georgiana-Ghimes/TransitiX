import { describe, expect, it } from 'vitest';
import {
  annexDraftAmount,
  avizFieldConfidence,
  avizIncarcareDate,
  avizMatchesListFilters,
  datePresetRange,
  filtersToRevealUploads,
  normalizeExtractionSource,
  previewKind,
} from './avizOps.js';

describe('avizOps', () => {
  it('maps OCR providers to list badges', () => {
    expect(normalizeExtractionSource('pdf_text')).toBe('pdf-text');
    expect(normalizeExtractionSource('google_vision')).toBe('vision');
    expect(normalizeExtractionSource('stub')).toBe('stub');
  });

  it('flags empty TPO/auto/route as low confidence', () => {
    const c = avizFieldConfidence({ numar_tpo: '', numar_auto: '', ruta_transport: '' });
    expect(c.numar_tpo).toBe('low');
    expect(c.numar_auto).toBe('low');
    expect(c.ruta_transport).toBe('low');
  });

  it('sums draft invoice by TPO or km x tarif', () => {
    const row = { valoare_tpo: 100, km_parcursi: 10, tarif_km: 2 };
    expect(annexDraftAmount(row, 'tpo')).toBe(100);
    expect(annexDraftAmount(row, 'km_tarif')).toBe(20);
  });

  it('computes Bucharest week/month presets', () => {
    const week = datePresetRange('week', new Date('2026-08-19T12:00:00+03:00'));
    expect(week.from).toBe('2026-08-17');
    expect(week.to).toBe('2026-08-23');
    const month = datePresetRange('month', new Date('2026-08-19T12:00:00+03:00'));
    expect(month.from).toBe('2026-08-01');
    expect(month.to).toBe('2026-08-31');
  });

  it('detects pdf vs image preview', () => {
    expect(previewKind('/uploads/a.pdf')).toBe('pdf');
    expect(previewKind('/uploads/a.JPG')).toBe('image');
  });

  it('knows when a row is hidden by the active date filter', () => {
    const row = {
      id: '1',
      data_efectuare_cursa: '2026-09-02',
      created_at: '2026-09-02T10:00:00.000Z',
      status: 'extracted',
    };
    expect(avizMatchesListFilters(row, { from: '2026-08-01', to: '2026-08-31', date_field: 'cursa' }))
      .toBe(false);
    expect(avizMatchesListFilters(row, { from: '2026-09-01', to: '2026-09-30', date_field: 'cursa' }))
      .toBe(true);
    expect(avizMatchesListFilters(row, { from: '2026-08-01', to: '2026-08-31', date_field: 'incarcare' }))
      .toBe(false);
  });

  it('falls back to upload day when trip date is missing', () => {
    const row = {
      id: '1',
      data_efectuare_cursa: null,
      created_at: '2026-09-02T10:00:00.000Z',
      status: 'uploaded',
    };
    expect(avizMatchesListFilters(row, { from: '2026-09-01', to: '2026-09-30', date_field: 'cursa' }))
      .toBe(true);
    expect(avizIncarcareDate(row)).toBe('2026-09-02');
  });

  it('builds a reveal filter around upload dates', () => {
    expect(filtersToRevealUploads([
      { created_at: '2026-09-02T10:00:00.000Z' },
      { created_at: '2026-09-02T18:00:00.000Z' },
    ])).toEqual({
      date_field: 'incarcare',
      from: '2026-09-02',
      to: '2026-09-02',
    });
  });
});
