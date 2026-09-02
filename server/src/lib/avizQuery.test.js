import { describe, expect, it } from 'vitest';
import {
  annexDraftAmount,
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

describe('avizQuery', () => {
  it('maps providers to extraction_source', () => {
    expect(mapProviderToSource('pdf_text')).toBe('pdf-text');
    expect(mapProviderToSource('google_vision')).toBe('vision');
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

  it('flags duplicate TPO in a list without UNIQUE', () => {
    const flagged = flagDuplicateTpos([
      { id: '1', numar_tpo: 'TPO-1' },
      { id: '2', numar_tpo: 'TPO-1' },
      { id: '3', numar_tpo: 'TPO-2' },
    ]);
    expect(flagged[0].duplicate_tpo).toBe(true);
    expect(flagged[1].duplicate_tpo).toBe(true);
    expect(flagged[2].duplicate_tpo).toBe(false);
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
