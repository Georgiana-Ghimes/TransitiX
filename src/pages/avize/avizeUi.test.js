import { describe, expect, it } from 'vitest';
import {
  asAvizPage,
  AVIZ_DEFAULT_PAGE_SIZE,
  displayRoute,
  emptyForm,
  formatIncarcareLabel,
  hasManualAvizEdits,
  isLearnedRoute,
  isLockedRai,
  lowField,
  manualAvizEditLabels,
  shouldAutoDownloadEmailFallback,
  waitForAvizExtractSettled,
} from './avizeUi.js';

describe('avizeUi', () => {
  it('locks the Anexa Factura RAI template by name', () => {
    expect(isLockedRai({ is_default: true, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRai({ is_default: false, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRai({ is_default: true, name: 'Alt șablon' })).toBe(false);
  });

  it('formats upload metadata for the table', () => {
    const label = formatIncarcareLabel(
      { uploaded_by_name: 'Ion P.', created_at: '2026-03-10T08:00:00.000Z' },
      () => '2026-03-10',
    );
    expect(label).toBe('Ion P. · 2026-03-10');
    expect(formatIncarcareLabel({ uploaded_from: 'driver', created_at: '2026-03-10' }, () => '2026-03-10'))
      .toBe('Șofer · 2026-03-10');
  });

  it('detects manual edits before re-extract', () => {
    expect(hasManualAvizEdits({ corrected_fields: ['numar_tpo'] })).toBe(true);
    expect(hasManualAvizEdits({ corrected_fields: [] })).toBe(false);
  });

  it('spots an office edit that never touched corrected_fields', () => {
    const extracted = {
      corrected_fields: [],
      numar_tpo: 'TPO-1',
      numar_auto: 'B 100 XYZ',
      extracted_data: { values: { numar_tpo: 'TPO-1', numar_auto: 'B 100 XYZ' } },
    };
    expect(hasManualAvizEdits(extracted)).toBe(false);

    const edited = { ...extracted, numar_auto: 'B 200 ABC' };
    expect(hasManualAvizEdits(edited)).toBe(true);
    expect(manualAvizEditLabels(edited)).toEqual(['Număr auto']);
  });

  it('ignores formatting-only differences from OCR', () => {
    const row = {
      cantitate_marfa: 12.5,
      data_efectuare_cursa: '2026-03-10',
      tip_marfa: 'Beton',
      extracted_data: {
        values: {
          quantity: '12.50',
          data_efectuare_cursa: '2026-03-10T00:00:00.000Z',
          tip_marfa: ' Beton ',
        },
      },
    };
    expect(hasManualAvizEdits(row)).toBe(false);
  });

  it('stays quiet on a row that was never extracted', () => {
    expect(hasManualAvizEdits({ status: 'uploaded', numar_tpo: '', extracted_data: null }))
      .toBe(false);
  });

  it('does not flag fields re-extract leaves alone', () => {
    const row = {
      km_parcursi: 120,
      taxe_suplimentare: 100,
      observatii: 'Așteptare 2h',
      ruta_display: 'Militari',
      numar_tpo: 'TPO-1',
      extracted_data: { values: { numar_tpo: 'TPO-1' } },
    };
    expect(hasManualAvizEdits(row)).toBe(false);
  });

  it('prefers office ruta_display over parser route', () => {
    expect(displayRoute({ ruta_display: 'Militari', ruta_transport: 'Client → Livrare' })).toBe('Militari');
    expect(displayRoute({ ruta_transport: 'Client → Livrare' })).toBe('Client → Livrare');
  });

  it('detects a route filled from a learned company rule', () => {
    expect(isLearnedRoute({ extracted_data: { route_source: 'learned' } })).toBe(true);
    expect(isLearnedRoute({ extracted_data: {} })).toBe(false);
    expect(isLearnedRoute({})).toBe(false);
  });

  it('marks low-confidence fields', () => {
    expect(lowField({ field_confidence: { numar_tpo: 'low' } }, 'numar_tpo')).toBe(true);
    expect(lowField({}, 'numar_tpo')).toBe(false);
  });

  it('seeds edit form from a row including trip_id', () => {
    const form = emptyForm({ numar_tpo: 'TPO-1', trip_id: 'trip-9', ruta_display: 'B' });
    expect(form.numar_tpo).toBe('TPO-1');
    expect(form.trip_id).toBe('trip-9');
    expect(form.ruta_display).toBe('B');
  });

  it('auto-downloads the email stub annex only once per attempt', () => {
    expect(shouldAutoDownloadEmailFallback({ alreadyDownloaded: false, hasContent: true })).toBe(true);
    expect(shouldAutoDownloadEmailFallback({ alreadyDownloaded: true, hasContent: true })).toBe(false);
    expect(shouldAutoDownloadEmailFallback({ alreadyDownloaded: false, hasContent: false })).toBe(false);
  });

  it('normalises the paginated avize list response', () => {
    expect(asAvizPage([{ id: '1' }])).toEqual({
      items: [{ id: '1' }], total: 1, limit: 1, offset: 0,
    });
    expect(asAvizPage({ items: [{ id: '1' }], total: 40, limit: 20, offset: 20 })).toEqual({
      items: [{ id: '1' }], total: 40, limit: 20, offset: 20,
    });
    expect(asAvizPage(null)).toEqual({
      items: [], total: 0, limit: AVIZ_DEFAULT_PAGE_SIZE, offset: 0,
    });
  });

  it('waits until a background re-extract leaves uploaded', async () => {
    const sleeps = [];
    let n = 0;
    const settled = await waitForAvizExtractSettled(
      'doc-1',
      async () => {
        n += 1;
        if (n < 3) return { id: 'doc-1', status: 'uploaded', ruta_transport: 'old' };
        return { id: 'doc-1', status: 'extracted', ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal' };
      },
      { intervalMs: 1, timeoutMs: 1000, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(settled.ruta_transport).toMatch(/Republicii/);
    expect(settled.status).toBe('extracted');
    expect(n).toBe(3);
    expect(sleeps.length).toBe(2);
  });
});
