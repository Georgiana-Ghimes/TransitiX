import { describe, expect, it } from 'vitest';
import {
  annexDraftAmount,
  avizFieldConfidence,
  datePresetRange,
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
});
