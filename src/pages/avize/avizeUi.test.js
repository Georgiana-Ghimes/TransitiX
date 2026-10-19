import { describe, expect, it } from 'vitest';
import {
  annexReviewBlockedMessage,
  annexReviewBlockedRows,
  confirmBlockedRows,
  asAvizPage,
  consecutiveSameTpoPeers,
  previewFileUrlsForPeers,
  rowsMissingTpo,
  rowsNeedingCarouselEdit,
  rowsNeedingHitlCaution,
  sortAvizeByUploadAsc,
  AVIZ_ACTION_LEGEND,
  AVIZ_DEFAULT_PAGE_SIZE,
  AVIZ_STATUS_DOT_LEGEND,
  AVIZ_STATUS_DOT_ONELINER,
  CAROUSEL_EDIT_FIELDS,
  LOW_FIELD_TEXT_CLS,
  OCR_OWNED_FIELDS,
  isGoodsDocOnly,
  missingRequiredCarouselFields,
  rowsNeedingOcrVerify,
  unackedLowOcrFields,
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
  reviewDraftFromPayload,
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

  it('lists rows missing Număr TPO (whitespace counts as missing)', () => {
    const rows = [
      { id: 'a', numar_tpo: 'TPO-1', created_at: '2026-10-14T10:00:00Z' },
      { id: 'b', numar_tpo: '  ', created_at: '2026-10-14T08:00:00Z' },
      { id: 'c', numar_tpo: null, created_at: '2026-10-14T09:00:00Z' },
      { id: 'd', numar_tpo: 'TPO-2', created_at: '2026-10-14T11:00:00Z' },
    ];
    expect(rowsMissingTpo(rows).map((r) => r.id)).toEqual(['b', 'c']);
    expect(rowsMissingTpo(rows, ['a', 'c']).map((r) => r.id)).toEqual(['c']);
    expect(rowsMissingTpo(rows, ['a', 'd'])).toEqual([]);
  });

  it('treats goods-doc-only as optional TPO and required document marfă', () => {
    const goods = {
      id: 'g',
      numar_tpo: '',
      numar_document_marfa: 'TRO-0010722',
      data_efectuare_cursa: '2026-10-06',
      numar_auto: 'B-01-XXX',
      ruta_transport: 'A-B',
      goods_doc_only: true,
      created_at: '2026-10-14T08:00:00Z',
    };
    expect(isGoodsDocOnly(goods)).toBe(true);
    expect(isGoodsDocOnly({ extracted_data: { goods_doc_only: true } })).toBe(true);
    expect(missingRequiredCarouselFields(goods)).toEqual([]);
    expect(missingRequiredCarouselFields({ ...goods, numar_document_marfa: '' }))
      .toEqual(['numar_document_marfa']);
    expect(rowsMissingTpo([goods, { id: 'b', numar_tpo: '', created_at: '2026-10-14T09:00:00Z' }])
      .map((r) => r.id)).toEqual(['b']);
  });

  it('explains red-bold OCR text and hard TPO when merge is on', () => {
    const text = AVIZ_ACTION_LEGEND.map((i) => `${i.name} ${i.text}`).join(' ');
    expect(text).toMatch(/Text roșu bold|roșu bold/i);
    expect(text).toMatch(/OCR/i);
    expect(text).toMatch(/ștampilă|stampila/i);
    expect(text).toMatch(/Unește celulele TPO/);
    expect(text).toMatch(/fără Număr TPO|Număr TPO/i);
    expect(text).toMatch(/blocate|Verifică/i);
    expect(text).toMatch(/Doar document marfă|TRO\/PSL/i);
  });

  it('keeps HITL annex gate and status-dot strip copy', () => {
    expect(LOW_FIELD_TEXT_CLS).toMatch(/text-red-700/);
    expect(LOW_FIELD_TEXT_CLS).toMatch(/font-bold/);
    expect(AVIZ_STATUS_DOT_LEGEND.some((i) => i.key === 'hitl')).toBe(true);
    expect(AVIZ_STATUS_DOT_ONELINER).toMatch(/OCR nesigur/);
    expect(AVIZ_STATUS_DOT_ONELINER).toMatch(/blocate/i);
    expect(requiresAnnexReviewGate({
      status: 'extracted', validation_routing: 'hitl_required',
    })).toBe(true);
    // Confirmă pe HITL must still route through the gate (carousel when fields gap).
    expect(requiresAnnexReviewGate({
      status: 'extracted', needs_review: true, validation_routing: 'hitl_required',
    })).toBe(true);
  });

  it('treats unacked low OCR as needing carousel even when fields are filled', () => {
    const low = {
      id: 'low',
      status: 'extracted',
      created_at: '2026-10-14T09:00:00Z',
      numar_tpo: 'TPO-0033600',
      data_efectuare_cursa: '2026-10-07',
      numar_auto: 'B-42-RAI',
      ruta_transport: 'A-B',
      field_confidence: { numar_tpo: 'low' },
    };
    const ok = {
      id: 'ok',
      status: 'extracted',
      created_at: '2026-10-14T08:00:00Z',
      numar_tpo: 'TPO-1',
      data_efectuare_cursa: '2026-10-07',
      numar_auto: 'B-01-XXX',
      ruta_transport: 'A-B',
      field_confidence: { numar_tpo: 'ok' },
    };
    const acked = {
      ...low,
      id: 'acked',
      corrected_fields: ['numar_tpo'],
    };
    expect(unackedLowOcrFields(low)).toEqual(['numar_tpo']);
    expect(unackedLowOcrFields(acked)).toEqual([]);
    expect(unackedLowOcrFields({ ...low, status: 'confirmed' })).toEqual([]);
    expect(rowsNeedingOcrVerify([low, ok, acked]).map((r) => r.id)).toEqual(['low']);
    expect(rowsNeedingCarouselEdit([low, ok]).map((r) => r.id)).toEqual(['low']);
  });

  it('#91 Verificare OCR / Confirmă carousel expose every OCR-owned field (not only TPO/auto/dată/cantitate)', () => {
    const draft = reviewDraftFromPayload({
      values: {
        numar_tpo: 'TPO-1',
        numar_auto: 'B-01-XXX',
        data_efectuare_cursa: '2026-10-03',
        cantitate_marfa: '12',
        ruta_transport: 'Site → Livrare',
        tip_marfa: 'Adeziv',
        gross_weight_kg: '9000',
        net_weight_kg: '8500',
        numar_document_marfa: 'PSL-1',
      },
      issues: [{ field: 'ruta_transport', value: 'Site → Livrare' }],
    });
    for (const key of OCR_OWNED_FIELDS) {
      expect(draft).toHaveProperty(key);
    }
    expect(draft.ruta_transport).toBe('Site → Livrare');
    expect(draft.gross_weight_kg).toBe('9000');
    expect(draft.tip_marfa).toBe('Adeziv');
    expect(draft.numar_document_marfa).toBe('PSL-1');

    const carouselKeys = CAROUSEL_EDIT_FIELDS.map((f) => f.key);
    for (const key of [
      'ruta_transport', 'tip_marfa', 'cantitate_marfa',
      'gross_weight_kg', 'net_weight_kg', 'numar_document_marfa',
    ]) {
      expect(carouselKeys).toContain(key);
    }
  });

  it('#95 HITL / verificare obligatorie needs caution even when carousel has nothing to type', () => {
    const hitl = {
      id: 'hitl',
      status: 'extracted',
      created_at: '2026-10-14T10:00:00Z',
      numar_tpo: 'TPO-0033244',
      data_efectuare_cursa: '2026-10-03',
      numar_auto: 'IF-90-SMB',
      ruta_transport: 'Str. Industries nr. 7, Bolintin-Deal / Str. Garii nr. 12, Chiajna',
      validation_routing: 'hitl_required',
      needs_review: true,
      field_confidence: { ruta_transport: 'ok' },
    };
    const clear = {
      id: 'clear',
      status: 'extracted',
      created_at: '2026-10-14T09:00:00Z',
      numar_tpo: 'TPO-1',
      data_efectuare_cursa: '2026-10-03',
      numar_auto: 'B-01-XXX',
      ruta_transport: 'A-B',
      validation_routing: 'auto',
      needs_review: false,
    };
    // Fields complete → no carousel page, but confirm gate must still warn (#95).
    expect(rowsNeedingCarouselEdit([hitl])).toEqual([]);
    expect(rowsNeedingHitlCaution([hitl, clear]).map((r) => r.id)).toEqual(['hitl']);
    expect(rowsNeedingHitlCaution([hitl, clear], ['clear'])).toEqual([]);
    expect(requiresAnnexReviewGate(hitl)).toBe(true);
    expect(requiresAnnexReviewGate({ ...hitl, status: 'confirmed' })).toBe(false);
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
