import { describe, expect, it } from 'vitest';
import {
  annexDraftAmount,
  applyNumarCurseByRuns,
  buildAvizListQuery,
  capAvizIds,
  flagDuplicateTpos,
  isLockedRaiTemplate,
  mapProviderToSource,
  pickConfirmedAvize,
  templateDeleteDecision,
  templateUpdateDecision,
  uniqueZipEntry,
} from './avizQuery.js';
import { DEFAULT_RAI_COLUMNS, exportColumnsFor } from './avizTemplate.js';

describe('avizQuery', () => {
  it('maps providers to extraction_source', () => {
    expect(mapProviderToSource('pdf_text')).toBe('pdf-text');
    expect(mapProviderToSource('google_vision')).toBe('vision');
  });

  it('keeps paddle and a failed read out of stub', () => {
    // `stub` means "no OCR was attempted". A real PaddleOCR read and a failed one are both
    // something else, and the badge is what an operator trusts when a field looks wrong.
    expect(mapProviderToSource('paddle')).toBe('paddle');
    expect(mapProviderToSource('paddle_ocr')).toBe('paddle');
    expect(mapProviderToSource('none')).toBe('none');
    expect(mapProviderToSource('')).toBe('stub');
    expect(mapProviderToSource('something_else')).toBe('stub');
  });

  it('filters by date, status and search', () => {
    const { sql, params } = buildAvizListQuery({
      companyId: 'co',
      from: '2026-08-01',
      to: '2026-08-31',
      status: 'confirmed',
      q: 'TPO-1',
    });
    expect(sql).toMatch(/a\.data_efectuare_cursa >= \$2::date/);
    expect(sql).toMatch(/strpos\(lower/);
    expect(sql).toMatch(/uploaded_by_name/);
    expect(sql).toMatch(/u\.company_id = a\.company_id/);
    expect(params[0]).toBe('co');
    expect(params).toContain('2026-08-01');
    expect(params).toContain('TPO-1');
    expect(params).not.toContain('%TPO-1%');
  });

  it('filters on the upload day when asked, in Bucharest time', () => {
    const { sql, params } = buildAvizListQuery({
      companyId: 'co',
      from: '2026-08-24',
      to: '2026-08-30',
      dateField: 'incarcare',
    });
    expect(sql).toMatch(/a\.created_at >= \(\$2::date AT TIME ZONE 'Europe\/Bucharest'\)/);
    expect(sql).toMatch(/a\.created_at < \(\(\$3::date \+ 1\) AT TIME ZONE 'Europe\/Bucharest'\)/);
    expect(sql).not.toMatch(/data_efectuare_cursa/);
    expect(params).toContain('2026-08-24');
  });

  it('keeps the trip date for an unknown or missing date_field', () => {
    for (const dateField of [undefined, '', 'created_at; DROP TABLE aviz_documents']) {
      const { sql } = buildAvizListQuery({ companyId: 'co', from: '2026-08-01', dateField });
      expect(sql).toMatch(/a\.data_efectuare_cursa >= \$2::date/);
      expect(sql).not.toMatch(/DROP TABLE/);
    }
  });

  it('falls back to the upload day for rows OCR has not dated yet', () => {
    const { sql } = buildAvizListQuery({ companyId: 'co', from: '2026-08-01', to: '2026-08-31' });
    expect(sql).toMatch(/a\.data_efectuare_cursa IS NULL AND a\.created_at >=/);
    expect(sql).toMatch(/a\.data_efectuare_cursa IS NULL AND a\.created_at </);
  });

  it('compares stored columns so the date indexes stay usable', () => {
    const cursa = buildAvizListQuery({ companyId: 'co', from: '2026-08-01' }).sql;
    const incarcare = buildAvizListQuery({
      companyId: 'co', from: '2026-08-01', dateField: 'incarcare',
    }).sql;
    for (const sql of [cursa, incarcare]) {
      expect(sql).not.toMatch(/COALESCE\(a\.data_efectuare_cursa/);
      expect(sql).not.toMatch(/\(a\.created_at AT TIME ZONE[^)]*\)::date >=/);
    }
  });

  it('filters paperwork from the cab', () => {
    const { sql, params } = buildAvizListQuery({
      companyId: 'co',
      uploadedFrom: 'driver',
    });
    expect(sql).toMatch(/uploaded_from =/);
    expect(params).toContain('driver');
  });

  it('caps id lists at 200 and unique zip names', () => {
    expect(capAvizIds(['a', 'a', 'b'].concat(Array.from({ length: 250 }, (_, i) => String(i))))).toHaveLength(200);
    const used = new Set();
    expect(uniqueZipEntry('originale/a.pdf', used)).toBe('originale/a.pdf');
    expect(uniqueZipEntry('originale/a.pdf', used)).toBe('originale/a-1.pdf');
  });

  it('flags the same aviz uploaded twice under one TPO', () => {
    const flagged = flagDuplicateTpos([
      { id: '1', numar_tpo: 'TPO-1', numar_document_marfa: 'PSL-0044633' },
      { id: '2', numar_tpo: 'TPO-1', numar_document_marfa: 'PSL-0044633' },
      { id: '3', numar_tpo: 'TPO-2', numar_document_marfa: 'PSL-0044701' },
    ]);
    expect(flagged[0].duplicate_tpo).toBe(true);
    expect(flagged[1].duplicate_tpo).toBe(true);
    expect(flagged[2].duplicate_tpo).toBe(false);
  });

  it('leaves a TPO driven twice alone, those are two curse and not a duplicate', () => {
    // TPO-0025803 covers a Monday delivery to Viilor and a Tuesday one to Iuliu Maniu. Warning
    // about double billing on both is how an operator learns to click past the warning.
    const flagged = flagDuplicateTpos([
      {
        id: '1', numar_tpo: 'TPO-0025803', numar_document_marfa: 'PSL-0044633',
        data_efectuare_cursa: '2026-08-10', numar_auto: 'B-34-BAU',
        ruta_transport: 'Bol-Bucuresti/Viilor52',
      },
      {
        id: '2', numar_tpo: 'TPO-0025803', numar_document_marfa: 'PSL-0044701',
        data_efectuare_cursa: '2026-08-11', numar_auto: 'B-34-BAU',
        ruta_transport: 'Bol-Bucuresti/IuliuManiu600A',
      },
    ]);
    expect(flagged.map((r) => r.duplicate_tpo)).toEqual([false, false]);
  });

  it('falls back to the run and the destination when no aviz number was read', () => {
    const rows = [
      {
        id: '1', numar_tpo: 'TPO-1', data_efectuare_cursa: '2026-08-10',
        numar_auto: 'B-34-BAU', ruta_transport: 'Bol-Bucuresti/Viilor52',
      },
      {
        id: '2', numar_tpo: 'TPO-1', data_efectuare_cursa: '2026-08-10',
        numar_auto: 'B-34-BAU', ruta_transport: 'Bol-Bucuresti/Viilor52',
      },
      {
        id: '3', numar_tpo: 'TPO-1', data_efectuare_cursa: '2026-08-10',
        numar_auto: 'B-34-BAU', ruta_transport: 'Bol-Bucuresti/IuliuManiu600A',
      },
    ];
    // Same day, same lorry, same destination, nothing to tell them apart: duplicate.
    // A different destination is a second drop, not the same paper twice.
    expect(flagDuplicateTpos(rows).map((r) => r.duplicate_tpo)).toEqual([true, true, false]);
  });

  it('does not call two bare rows duplicates just because they share a TPO', () => {
    // Freshly uploaded, nothing extracted yet. There is no evidence either way, and inventing
    // a duplicate here is what made the warning worthless on the rows that matter.
    const flagged = flagDuplicateTpos([
      { id: '1', numar_tpo: 'TPO-1' },
      { id: '2', numar_tpo: 'TPO-1' },
    ]);
    expect(flagged.map((r) => r.duplicate_tpo)).toEqual([false, false]);
  });

  it('counts distinct runs per TPO, not avize', () => {
    // Two trucks on the same TPO / day → 2 curse on both rows.
    const twoTrucks = applyNumarCurseByRuns([
      { id: 'a', numar_tpo: 'TPO-100', data_efectuare_cursa: '2026-09-10', numar_auto: 'B 111 AAA' },
      { id: 'b', numar_tpo: 'TPO-100', data_efectuare_cursa: '2026-09-10', numar_auto: 'B 222 BBB' },
    ]);
    expect(twoTrucks.map((r) => r.numar_curse)).toEqual([2, 2]);

    // Two unloadings, same truck/day → still 1 cursă.
    const twoUnloadings = applyNumarCurseByRuns([
      { id: 'a', numar_tpo: 'TPO-100', data_efectuare_cursa: '2026-09-10', numar_auto: 'B-111-AAA' },
      { id: 'b', numar_tpo: 'TPO-100', data_efectuare_cursa: '2026-09-10', numar_auto: 'B 111 AAA' },
    ]);
    expect(twoUnloadings.map((r) => r.numar_curse)).toEqual([1, 1]);
  });

  it('treats linked trip_id as the run, not each aviz', () => {
    const sameTrip = applyNumarCurseByRuns([
      { id: 'a', numar_tpo: 'TPO-9', trip_id: 'trip-1', numar_auto: 'B 1', data_efectuare_cursa: '2026-01-01' },
      { id: 'b', numar_tpo: 'TPO-9', trip_id: 'trip-1', numar_auto: 'B 1', data_efectuare_cursa: '2026-01-01' },
      { id: 'c', numar_tpo: 'TPO-9', trip_id: 'trip-2', numar_auto: 'B 2', data_efectuare_cursa: '2026-01-01' },
    ]);
    expect(sameTrip.map((r) => r.numar_curse)).toEqual([2, 2, 2]);
  });

  it('locks the Anexa Factura RAI template by name', () => {
    expect(isLockedRaiTemplate({ is_default: true, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRaiTemplate({ is_default: false, name: 'Anexa Factura RAI' })).toBe(true);
    expect(isLockedRaiTemplate({ is_default: true, name: 'Alt șablon' })).toBe(false);
  });

  it('drafts invoice amount from TPO or km x tarif', () => {
    const row = { valoare_tpo: 80, km_parcursi: 10, tarif_km: 3 };
    expect(annexDraftAmount(row, 'tpo')).toBe(80);
    expect(annexDraftAmount(row, 'km_tarif')).toBe(30);
  });

  it('only drafts invoices from confirmed avize', () => {
    expect(pickConfirmedAvize([
      { id: '1', status: 'extracted' },
      { id: '2', status: 'confirmed' },
    ]).map((r) => r.id)).toEqual(['2']);
  });

  it('blocks deleting or overwriting locked Anexa Factura RAI', () => {
    const locked = { is_default: false, name: 'Anexa Factura RAI' };
    expect(templateDeleteDecision({ count: 3, existing: locked })).toBe('locked_rai');
    expect(templateDeleteDecision({ count: 1, existing: { name: 'Altul' } })).toBe('keep_one');
    expect(templateDeleteDecision({ count: 2, existing: null })).toBe('not_found');
    expect(templateDeleteDecision({ count: 2, existing: { name: 'Altul' } })).toBe('ok');
    expect(templateUpdateDecision(locked)).toBe('locked_rai');
    expect(templateUpdateDecision({ name: 'Custom' })).toBe('ok');
  });
});

describe('the locked annex layout', () => {
  it('is the fourteen columns the customer sheet prints, in that order', () => {
    expect(DEFAULT_RAI_COLUMNS.map((c) => c.header)).toEqual([
      'Nr. Crt.', 'Numar TPO', 'Data efectuare cursa', 'Valoare TPO', 'Numar auto',
      'Ruta transport', 'Tip marfa', 'Cantitate marfa (tone)',
      'Numar document marfa (aviz/factura)', 'Numar curse', 'Taxe suplimentare',
      'Km parcursi', 'Tarif Km', 'Observatii',
    ]);
  });

  it('ignores stored columns for the locked template', () => {
    // report_templates rows are seeded once and never updated, so a company seeded before a
    // header fix would keep sending the old sheet. The locked layout lives in code.
    const stale = {
      name: 'Anexa Factura RAI',
      columns: [{ key: 'numar_tpo', header: 'TPO vechi', source: 'numar_tpo' }],
    };
    expect(exportColumnsFor(stale).map((c) => c.header))
      .toEqual(DEFAULT_RAI_COLUMNS.map((c) => c.header));
  });

  it('still honours a custom template with its own columns', () => {
    const custom = {
      name: 'Raport intern',
      columns: [{ key: 'numar_tpo', header: 'TPO', source: 'numar_tpo' }],
    };
    expect(exportColumnsFor(custom).map((c) => c.header)).toEqual(['TPO']);
  });

  it('still refuses a custom template with no columns', () => {
    expect(() => exportColumnsFor({ name: 'Gol', columns: [] })).toThrow(/nicio coloană/);
  });
});
