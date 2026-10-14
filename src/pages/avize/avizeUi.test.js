import { describe, expect, it } from 'vitest';
import {
  annexReviewBlockedMessage,
  annexReviewBlockedRows,
  confirmBlockedRows,
  asAvizPage,
  consecutiveSameTpoPeers,
  previewFileUrlsForPeers,
  rowsNeedingCarouselEdit,
  sortAvizeByUploadAsc,
  AVIZ_DEFAULT_PAGE_SIZE,
  displayRoute,
  emptyForm,
  formatIncarcareLabel,
  hasManualAvizEdits,
  isLearnedRoute,
  canDeleteTemplate,
  isLockedRai,
  avizEditFindings,
  findingsForField,
  lowField,
  manualAvizEditLabels,
  requiresAnnexReviewGate,
  shouldAutoDownloadEmailFallback,
  TEMPLATE_ACTION_LEGEND,
  waitForAvizExtractSettled,
} from './avizeUi.js';

describe('avizeUi', () => {
  it('locks the Anexa layout by name or preset_id; defaults can be renamed not deleted (#83)', () => {
    expect(isLockedRai({ is_default: true, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRai({ is_default: false, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRai({ is_default: true, name: 'Alt șablon' })).toBe(false);
    expect(isLockedRai({ name: 'Anexa birou', preset_id: 'rai_anexa' })).toBe(true);
    expect(canDeleteTemplate({ name: 'Anexa Factura RAI' })).toBe(false);
    expect(canDeleteTemplate({ is_default: true, name: 'Raport' })).toBe(false);
    expect(canDeleteTemplate({ is_default: false, name: 'Raport' })).toBe(true);
  });

  it('explains implicit rename vs Anexa column lock (#83)', () => {
    const text = TEMPLATE_ACTION_LEGEND.map((i) => `${i.name} ${i.text}`).join(' ');
    expect(text).toMatch(/redenumi/i);
    expect(text).toMatch(/nu îl poți șterge|Nu se șterg|nu se șterg/i);
  });

  it('blocks annex export for Verificare obligatorie, not for Confirmat', () => {
    expect(requiresAnnexReviewGate({
      status: 'extracted', validation_routing: 'hitl_required',
    })).toBe(true);
    expect(requiresAnnexReviewGate({
      status: 'extracted', needs_review: true,
    })).toBe(true);
    expect(requiresAnnexReviewGate({
      status: 'confirmed', validation_routing: 'hitl_required', needs_review: true,
    })).toBe(false);
    expect(requiresAnnexReviewGate({
      status: 'extracted', validation_routing: 'hitl_optional', needs_review: false,
    })).toBe(false);
    // After „Marchează verificat”, stored validation is auto + needs_review false;
    // list decoration may still set needs_review true — annex must follow stored.
    expect(requiresAnnexReviewGate({
      status: 'extracted',
      needs_review: true,
      validation_routing: 'hitl_optional',
      extracted_data: { validation: { routing: 'auto', needs_review: false } },
    })).toBe(false);
    expect(requiresAnnexReviewGate({
      status: 'extracted',
      needs_review: true,
      extracted_data: { validation: { routing: 'hitl_optional', needs_review: true } },
    })).toBe(true);

    const blocked = annexReviewBlockedRows(
      [
        { id: 'a', status: 'extracted', validation_routing: 'hitl_required' },
        { id: 'b', status: 'confirmed', validation_routing: 'hitl_required' },
        { id: 'c', status: 'extracted', needs_review: false },
      ],
      ['a', 'b', 'c'],
    );
    expect(blocked.map((r) => r.id)).toEqual(['a']);
    expect(annexReviewBlockedMessage(2)).toMatch(/2 documente necesită verificare/);

    const ordered = confirmBlockedRows(
      [
        { id: 'new', status: 'extracted', needs_review: true, created_at: '2026-10-14T12:00:00Z' },
        { id: 'old', status: 'extracted', needs_review: true, created_at: '2026-10-14T08:00:00Z' },
      ],
      ['new', 'old'],
    );
    expect(ordered.map((r) => r.id)).toEqual(['old', 'new']);
    expect(sortAvizeByUploadAsc([
      { id: 'b', created_at: '2026-10-14T11:00:00Z' },
      { id: 'a', created_at: '2026-10-14T09:00:00Z' },
    ]).map((r) => r.id)).toEqual(['a', 'b']);

    const editOnly = rowsNeedingCarouselEdit([
      {
        id: 'full',
        created_at: '2026-10-14T08:00:00Z',
        numar_tpo: 'TPO-1',
        data_efectuare_cursa: '2026-10-07',
        numar_auto: 'B-01-XXX',
        ruta_transport: 'A-B',
        needs_review: true,
      },
      {
        id: 'gap',
        created_at: '2026-10-14T09:00:00Z',
        numar_tpo: '',
        data_efectuare_cursa: '2026-10-07',
        numar_auto: 'B-02-YYY',
        ruta_transport: 'A-B',
        needs_review: true,
      },
    ]);
    expect(editOnly.map((r) => r.id)).toEqual(['gap']);
  });

  it('glues only adjacent same-TPO peers for merge preview', () => {
    const rows = [
      { id: 'a', numar_tpo: 'TPO-1', file_url: '/a.pdf', created_at: '2026-10-14T08:00:00Z' },
      { id: 'b', numar_tpo: 'TPO-1', file_url: '/b.pdf', created_at: '2026-10-14T09:00:00Z' },
      { id: 'c', numar_tpo: 'TPO-2', file_url: '/c.pdf', created_at: '2026-10-14T10:00:00Z' },
      { id: 'd', numar_tpo: 'TPO-1', file_url: '/d.pdf', created_at: '2026-10-14T11:00:00Z' },
    ];
    expect(consecutiveSameTpoPeers(rows, 'b').map((r) => r.id)).toEqual(['a', 'b']);
    expect(consecutiveSameTpoPeers(rows, 'd').map((r) => r.id)).toEqual(['d']);
    expect(previewFileUrlsForPeers(consecutiveSameTpoPeers(rows, 'a'))).toEqual(['/a.pdf', '/b.pdf']);
  });

  it('tells the operator template names are unique per company', () => {
    const text = TEMPLATE_ACTION_LEGEND.map((item) => item.text).join(' ');
    expect(text).toMatch(/unic pe firmă/);
    expect(text).toMatch(/Șablon nou \(2\)/);
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

  it('surfaces date_missing in Editează until the operator types a date (#81)', () => {
    const row = {
      validation_findings: [{
        rule: 'date_missing',
        severity: 'error',
        field: 'data_efectuare_cursa',
        title: 'Dată cursă lipsă',
        message: 'completează manual Data efectuare cursă',
      }],
    };
    const open = avizEditFindings(row, { form: { data_efectuare_cursa: '' } });
    expect(open).toHaveLength(1);
    expect(findingsForField(open, 'data_efectuare_cursa')).toHaveLength(1);
    expect(avizEditFindings(row, { form: { data_efectuare_cursa: '2026-10-05' } })).toEqual([]);
  });

  it('seeds edit form from a row including trip_id', () => {
    const form = emptyForm({ numar_tpo: 'TPO-1', trip_id: 'trip-9', ruta_display: 'B' });
    expect(form.numar_tpo).toBe('TPO-1');
    expect(form.trip_id).toBe('trip-9');
    expect(form.ruta_display).toBe('B');
  });

  it('stringifies numeric row values for controlled Editează inputs', () => {
    const form = emptyForm({
      gross_weight_kg: 1234.5,
      cantitate_marfa: 0,
      valoare_tpo: null,
    });
    expect(form.gross_weight_kg).toBe('1234.5');
    expect(form.cantitate_marfa).toBe('0');
    expect(form.valoare_tpo).toBe('');
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
