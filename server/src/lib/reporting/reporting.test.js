import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  REPORT_SOURCES,
  WEIGHT_SOURCES,
  canTotal,
  getSource,
  isNumericSource,
  numberFormatFor,
} from './sources.js';
import { REPORT_PRESETS, getPreset, listPresets } from './presets.js';
import { buildReport, describeColumns, reportTotals, reportWarnings } from './build.js';
import {
  SELECTION_CAP,
  buildSelectionQuery,
  describeSelection,
  isEmptySelection,
  normaliseFilters,
} from './select.js';
import { renderReportWorkbook } from '../avizExport.js';

const CONFIRMED = {
  id: 'doc-1',
  status: 'confirmed',
  needs_review: false,
  numar_tpo: 'TPO 2026-0311',
  data_efectuare_cursa: '2026-03-10',
  numar_auto: 'B 123 ABC',
  ruta_transport: 'Bucuresti - Chiajna',
  tip_marfa: 'Mortar uscat',
  cantitate_marfa: 378,
  quantity_unit: 'saci',
  pallets: 18,
  gross_weight_kg: 9000,
  net_weight_kg: 8244,
  numar_document_marfa: 'PSL 4417/2026',
  data_facturare: '2026-03-31',
  km_parcursi: 42,
  tarif_km: 2.5,
  valoare_tpo: 105,
};

const UNWEIGHED = {
  id: 'doc-2',
  status: 'extracted',
  needs_review: true,
  numar_tpo: 'TPO 2026-0312',
  data_efectuare_cursa: '2026-03-11',
  numar_auto: 'B 777 TRX',
  gross_weight_kg: null,
  km_parcursi: 58,
  tarif_km: 2.5,
  valoare_tpo: 145,
};

// ----------------------------------------------------------------- sources

describe('report sources', () => {
  it('gives every source a label and a type', () => {
    expect(REPORT_SOURCES.every((s) => s.label && s.type)).toBe(true);
  });

  it('knows which sources are numeric', () => {
    expect(isNumericSource('gross_weight_kg')).toBe(true);
    expect(isNumericSource('numar_auto')).toBe(false);
  });

  it('never totals a rate, because a summed rate means nothing', () => {
    expect(canTotal('tarif_km')).toBe(false);
    expect(canTotal('km_parcursi')).toBe(true);
    expect(canTotal('gross_weight_kg')).toBe(true);
  });

  it('formats weight without decimals and a tariff with four', () => {
    expect(numberFormatFor('gross_weight_kg')).toBe('#,##0');
    expect(numberFormatFor('tarif_km')).toBe('#,##0.0000');
  });

  it('knows every weighed source', () => {
    expect(WEIGHT_SOURCES).toContain('gross_weight_kg');
    expect(WEIGHT_SOURCES).not.toContain('cantitate_marfa');
  });

  it('returns nothing for an unknown key rather than a guess', () => {
    expect(getSource('inventat')).toBeNull();
  });
});

// ----------------------------------------------------------------- presets

describe('the billing date is not the trip date', () => {
  it('offers both as separate sources', () => {
    // A tariff is read as of the day the trip ran. Folding the two into one column would make a
    // mid-month rate change unauditable.
    const keys = REPORT_SOURCES.map((s) => s.key);
    expect(keys).toContain('data_efectuare_cursa');
    expect(keys).toContain('data_facturare');
  });

  it('puts the billing date on the monthly settlement sheet', () => {
    const sources = getPreset('centralizator_km').columns.map((c) => c.source);
    expect(sources).toContain('data_facturare');
    expect(sources).toContain('data_efectuare_cursa');
  });

  it('leaves the contractual RAI annex alone', () => {
    // Adding a column to a layout agreed with the customer is not ours to decide.
    const sources = getPreset('rai_anexa').columns.map((c) => c.source);
    expect(sources).not.toContain('data_facturare');
  });

  it('renders it the way a Romanian sheet reads', () => {
    const report = buildReport({ template: getPreset('centralizator_km'), documents: [CONFIRMED] });
    expect(report.rows[0].data_facturare).toBe('31.03.2026');
    expect(report.rows[0].data_efectuare_cursa).toBe('10.03.2026');
  });

  it('never totals a date', () => {
    expect(canTotal('data_facturare')).toBe(false);
  });
});

describe('presets', () => {
  it('ships the contractual RAI annex unchanged, at fourteen columns', () => {
    const rai = getPreset('rai_anexa');
    expect(rai.columns).toHaveLength(14);
    expect(rai.locked).toBe(true);
  });

  it('ships a Baumit layout that carries the weighbridge figure', () => {
    const sources = getPreset('baumit_greutati').columns.map((c) => c.source);
    expect(sources).toContain('gross_weight_kg');
    expect(sources).toContain('net_weight_kg');
  });

  it('keeps quantity beside the weight rather than in its place', () => {
    const sources = getPreset('baumit_greutati').columns.map((c) => c.source);
    expect(sources).toContain('cantitate_marfa');
    expect(sources).toContain('quantity_unit');
  });

  it('defaults a measurement column to blank, not to zero', () => {
    const gross = getPreset('baumit_greutati').columns.find((c) => c.source === 'gross_weight_kg');
    expect(gross.default_value).toBe('');
  });

  it('lists presets with what they contain', () => {
    expect(listPresets()).toHaveLength(REPORT_PRESETS.length);
    expect(listPresets()[0]).toHaveProperty('column_count');
  });

  it('returns nothing for an unknown preset', () => {
    expect(getPreset('nope')).toBeNull();
  });
});

// ------------------------------------------------------------------ totals

describe('reportTotals', () => {
  const template = getPreset('baumit_greutati');

  it('sums the weight across the selection', () => {
    const report = buildReport({ template, documents: [CONFIRMED, { ...CONFIRMED, id: 'doc-3', gross_weight_kg: 7500 }] });
    expect(report.totals.gross_weight_kg.value).toBe(16500);
    expect(report.totals.gross_weight_kg.counted).toBe(2);
  });

  it('counts a missing weighing as missing, not as zero', () => {
    const report = buildReport({ template, documents: [CONFIRMED, UNWEIGHED] });
    expect(report.totals.gross_weight_kg.value).toBe(9000);
    expect(report.totals.gross_weight_kg.missing).toBe(1);
  });

  it('leaves a rate column out of the totals', () => {
    const report = buildReport({ template: getPreset('centralizator_km'), documents: [CONFIRMED, UNWEIGHED] });
    expect(report.totals.km_parcursi.value).toBe(100);
    expect(report.totals).not.toHaveProperty('tarif_km');
  });

  it('omits a column nothing filled in', () => {
    expect(reportTotals(template.columns, [{}])).toEqual({});
  });
});

// ---------------------------------------------------------------- warnings

describe('reportWarnings', () => {
  const codes = (docs, template) => reportWarnings(template.columns, docs).map((w) => w.code);

  it('says when documents that are not confirmed are going out', () => {
    expect(codes([UNWEIGHED], getPreset('baumit_greutati'))).toContain('not_confirmed');
  });

  it('says when a field nobody checked is going out', () => {
    expect(codes([UNWEIGHED], getPreset('baumit_greutati'))).toContain('needs_review');
  });

  it('says when a weight column has no weighing behind it', () => {
    expect(codes([UNWEIGHED], getPreset('baumit_greutati'))).toContain('missing_gross_weight');
  });

  it('warns when a billing column has no billing date behind it', () => {
    const withoutDate = { ...CONFIRMED, id: 'doc-9', data_facturare: null };
    const codes = reportWarnings(getPreset('centralizator_km').columns, [withoutDate])
      .map((w) => w.code);
    expect(codes).toContain('missing_invoice_date');
  });

  it('does not ask for a billing date on a template that has no such column', () => {
    const withoutDate = { ...CONFIRMED, id: 'doc-9', data_facturare: null };
    const codes = reportWarnings(getPreset('baumit_greutati').columns, [withoutDate])
      .map((w) => w.code);
    expect(codes).not.toContain('missing_invoice_date');
  });

  it('says when the documents have a weight the template drops', () => {
    // The RAI annex is contractual, so we do not rewrite it — but a sheet that cannot be
    // reconciled against the weighbridge has to say so out loud.
    expect(codes([CONFIRMED], getPreset('rai_anexa'))).toContain('weight_not_exported');
  });

  it('does not complain about a missing weight when no weight is exported', () => {
    expect(codes([UNWEIGHED], getPreset('rai_anexa'))).not.toContain('missing_gross_weight');
  });

  it('flags the same TPO appearing twice', () => {
    const found = reportWarnings(getPreset('rai_anexa').columns, [CONFIRMED, { ...CONFIRMED, id: 'doc-4' }]);
    const dup = found.find((w) => w.code === 'duplicate_tpo');
    expect(dup.count).toBe(2);
  });

  it('stays quiet on a clean, confirmed selection', () => {
    expect(codes([CONFIRMED], getPreset('baumit_greutati'))).toEqual([]);
  });
});

// ------------------------------------------------------------------- build

describe('buildReport', () => {
  it('numbers the rows and maps the fields', () => {
    const report = buildReport({ template: getPreset('baumit_greutati'), documents: [CONFIRMED, UNWEIGHED] });
    expect(report.row_count).toBe(2);
    expect(report.rows[0].nr_crt).toBe(1);
    expect(report.rows[0].gross_weight_kg).toBe(9000);
    expect(report.rows[1].gross_weight_kg).toBe('');
  });

  it('writes the date the way a Romanian sheet reads it', () => {
    const report = buildReport({ template: getPreset('baumit_greutati'), documents: [CONFIRMED] });
    expect(report.rows[0].data_efectuare_cursa).toBe('10.03.2026');
  });

  it('describes each column so the preview can right-align the numbers', () => {
    const columns = describeColumns(getPreset('baumit_greutati').columns);
    const gross = columns.find((c) => c.source === 'gross_weight_kg');
    expect(gross).toMatchObject({ numeric: true, totalled: true, type: 'weight' });
  });

  it('handles an empty selection without throwing', () => {
    const report = buildReport({ template: getPreset('rai_anexa'), documents: [] });
    expect(report.row_count).toBe(0);
    expect(report.totals).toEqual({});
  });
});

// --------------------------------------------------------------- selection

describe('selection', () => {
  it('reads a period, a plate and a status', () => {
    const { params } = buildSelectionQuery('c1', { from: '2026-03-01', to: '2026-03-31', plate: 'B 123', status: 'confirmed' });
    expect(params.slice(0, 5)).toEqual(['c1', '2026-03-01', '2026-03-31', 'confirmed', 'B 123']);
  });

  it('always scopes to the company', () => {
    const { sql } = buildSelectionQuery('c1', { from: '2026-03-01' });
    expect(sql).toContain('company_id = $1');
  });

  it('selects a whole batch, which is how a confirmed lot becomes a report', () => {
    const { sql } = buildSelectionQuery('c1', { batch_id: '11111111-1111-1111-1111-111111111111' });
    expect(sql).toContain('batch_id = $2::uuid');
  });

  it('can ask only for documents that were weighed', () => {
    const { sql } = buildSelectionQuery('c1', { with_weight: true });
    expect(sql).toContain('gross_weight_kg IS NOT NULL');
  });

  it('refuses a selection with no criteria, which would take the whole archive', () => {
    expect(isEmptySelection({})).toBe(true);
    expect(isEmptySelection({ from: '2026-03-01' })).toBe(false);
  });

  it('drops junk instead of passing it to the database', () => {
    const f = normaliseFilters({ from: 'ieri', status: 'inventat', limit: 99999 });
    expect(f.from).toBeNull();
    expect(f.status).toBeNull();
    expect(f.limit).toBe(SELECTION_CAP);
  });

  it('de-duplicates a hand-picked id list', () => {
    expect(normaliseFilters({ aviz_ids: ['a', 'a', 'b'] }).aviz_ids).toEqual(['a', 'b']);
  });

  it('describes a stored selection in words, for the history list', () => {
    expect(describeSelection({ from: '2026-03-01', to: '2026-03-31', plate: 'B 123' }))
      .toBe('2026-03-01 → 2026-03-31, auto B 123');
  });

  it('orders by trip date, because that is the order a customer reads', () => {
    const { sql } = buildSelectionQuery('c1', { from: '2026-03-01' });
    expect(sql).toContain('ORDER BY data_efectuare_cursa ASC NULLS LAST');
  });
});

// ---------------------------------------------------------------- workbook

async function readSheet(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  return read.worksheets[0];
}

describe('workbook rendering', () => {
  const template = getPreset('baumit_greutati');

  it('adds a totals line when asked', async () => {
    const report = buildReport({ template, documents: [CONFIRMED, UNWEIGHED] });
    const sheet = await readSheet(renderReportWorkbook({
      name: template.name,
      columns: template.columns,
      rows: report.rows,
      totals: report.totals,
    }));
    const last = sheet.getRow(sheet.rowCount);
    const grossIdx = template.columns.findIndex((c) => c.source === 'gross_weight_kg') + 1;
    expect(last.getCell(grossIdx).value).toBe(9000);
  });

  it('labels the totals line so nobody reads it as another delivery', async () => {
    const report = buildReport({ template, documents: [CONFIRMED] });
    const sheet = await readSheet(renderReportWorkbook({
      name: template.name,
      columns: template.columns,
      rows: report.rows,
      totals: report.totals,
    }));
    const values = sheet.getRow(sheet.rowCount).values.map((v) => (v == null ? '' : v));
    expect(values).toContain('TOTAL');
  });

  it('leaves the sheet alone when no totals are wanted', async () => {
    const report = buildReport({ template, documents: [CONFIRMED, UNWEIGHED] });
    const sheet = await readSheet(renderReportWorkbook({
      name: template.name,
      columns: template.columns,
      rows: report.rows,
      totals: null,
    }));
    expect(sheet.rowCount).toBe(3);
  });

  it('renders a stored snapshot, so a re-download is the same sheet', async () => {
    const report = buildReport({ template, documents: [CONFIRMED] });
    const snapshot = { columns: template.columns, rows: report.rows, totals: report.totals };
    const first = await readSheet(renderReportWorkbook({ name: 'Raport', ...snapshot }));
    const again = await readSheet(renderReportWorkbook({ name: 'Raport', ...snapshot }));
    expect(again.getRow(2).values).toEqual(first.getRow(2).values);
  });
});
