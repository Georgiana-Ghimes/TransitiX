import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildMergeTpoFixtureAvize } from '../../../qa/samples/merge-tpo/build-fixture.mjs';
import { DEFAULT_RAI_COLUMNS, annexFieldDefaults } from './avizTemplate.js';
import { buildReport } from './reporting/build.js';
import { renderReportWorkbook } from './avizExport.js';

const TPO_COL = DEFAULT_RAI_COLUMNS.findIndex((c) => c.source === 'numar_tpo') + 1;
const PLATE_COL = DEFAULT_RAI_COLUMNS.findIndex((c) => c.source === 'numar_auto') + 1;
const RUNS = 50;
const ITERATIONS = Array.from({ length: RUNS }, (_, i) => i + 1);

function annexWorkbook(avize, mergeTpoCells) {
  const report = buildReport({
    template: { name: 'Baumit stress', columns: DEFAULT_RAI_COLUMNS },
    documents: avize,
  });
  return {
    report,
    workbook: renderReportWorkbook({
      name: 'Baumit stress',
      columns: report.columns,
      rows: report.rows,
      totals: null,
      mergeTpoCells,
    }),
  };
}

function tpoMergeRanges(sheet) {
  const merges = sheet.model?.merges || [];
  const list = Array.isArray(merges) ? merges : Object.keys(merges);
  return list
    .map((range) => String(range))
    .filter((addr) => {
      const m = addr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!m) return false;
      return m[1] === m[3] && Number(m[2]) < Number(m[4]);
    });
}

function scrambleSeed(seed) {
  let x = seed | 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function buildVariant(iteration) {
  const base = annexFieldDefaults();
  const rnd = scrambleSeed(iteration * 2654435761);
  const groupA = 2 + (rnd % 3);
  const groupB = 2 + ((rnd >>> 3) % 2);
  const solo = (rnd >>> 5) % 2;
  const tpoA = `TPO-STRESS-A-${iteration}`;
  const tpoB = `TPO-STRESS-B-${iteration}`;
  const tpoC = `TPO-STRESS-C-${iteration}`;
  const rows = [];
  for (let i = 0; i < groupA; i += 1) {
    rows.push({
      ...base,
      numar_tpo: tpoA,
      data_efectuare_cursa: '2026-10-07',
      numar_auto: `B-${String(10 + i).padStart(2, '0')}-AAA`,
      ruta_transport: 'A / B',
      numar_document_marfa: `PSL-A-${iteration}-${i}`,
      gross_weight_kg: 10000 + i * 100,
    });
  }
  for (let i = 0; i < groupB; i += 1) {
    rows.push({
      ...base,
      numar_tpo: tpoB,
      data_efectuare_cursa: '2026-10-08',
      numar_auto: `B-${String(20 + i).padStart(2, '0')}-BBB`,
      ruta_transport: 'C / D',
      numar_document_marfa: `PSL-B-${iteration}-${i}`,
      gross_weight_kg: 12000 + i * 100,
    });
  }
  if (solo) {
    rows.push({
      ...base,
      numar_tpo: tpoC,
      data_efectuare_cursa: '2026-10-09',
      numar_auto: 'B-99-CCC',
      ruta_transport: 'E / F',
      numar_document_marfa: `PSL-C-${iteration}`,
      gross_weight_kg: 9000,
    });
  }
  return { rows, groupA, groupB, solo: Boolean(solo), tpoA, tpoB };
}

describe('merge_tpo_cells — fixture + stress', () => {
  it('fixed Baumit fixture: ON merges 9001×3 and 9002×2; OFF never merges', async () => {
    const avize = buildMergeTpoFixtureAvize();
    const on = annexWorkbook(avize, true);
    const off = annexWorkbook(avize, false);
    const sheetOn = on.workbook.worksheets[0];
    const sheetOff = off.workbook.worksheets[0];

    expect(sheetOn.getCell(2, TPO_COL).value).toBe('TPO-MERGE-9001');
    expect(Boolean(sheetOn.getCell(2, TPO_COL).isMerged)).toBe(true);
    expect(Boolean(sheetOn.getCell(5, TPO_COL).isMerged)).toBe(true);
    expect(Boolean(sheetOn.getCell(7, TPO_COL).isMerged)).toBe(false);

    expect(Boolean(sheetOff.getCell(2, TPO_COL).isMerged)).toBe(false);
    expect(Boolean(sheetOff.getCell(3, TPO_COL).isMerged)).toBe(false);

    const buf = Buffer.from(await on.workbook.xlsx.writeBuffer());
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buf);
    expect(Boolean(loaded.worksheets[0].getCell(2, TPO_COL).isMerged)).toBe(true);
  });

  it.each(ITERATIONS)('random pack #%s — consecutive TPO merges, plates stay separate', (i) => {
    const { rows, groupA, groupB, solo, tpoA, tpoB } = buildVariant(i);
    const { report, workbook } = annexWorkbook(rows, true);
    const sheet = workbook.worksheets[0];

    expect(report.rows.length).toBe(rows.length);
    expect(Boolean(sheet.getCell(2, TPO_COL).isMerged)).toBe(true);
    expect(sheet.getCell(2, TPO_COL).value).toBe(tpoA);

    const bStart = 2 + groupA;
    expect(Boolean(sheet.getCell(bStart, TPO_COL).isMerged)).toBe(true);
    expect(sheet.getCell(bStart, TPO_COL).value).toBe(tpoB);

    if (solo) {
      const soloRow = bStart + groupB;
      expect(Boolean(sheet.getCell(soloRow, TPO_COL).isMerged)).toBe(false);
    }

    expect(Boolean(sheet.getCell(2, PLATE_COL).isMerged)).toBe(false);
    expect(Boolean(sheet.getCell(3, PLATE_COL).isMerged)).toBe(false);
  });

  it.each(ITERATIONS)('xlsx round-trip #%s — merge survives reload', async (i) => {
    const avize = buildMergeTpoFixtureAvize();
    const { workbook } = annexWorkbook(avize, true);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buf);
    const sheet = loaded.worksheets[0];
    expect(Boolean(sheet.getCell(2, TPO_COL).isMerged)).toBe(true);
    expect(sheet.getCell(2, TPO_COL).value).toBe('TPO-MERGE-9001');
    expect(tpoMergeRanges(sheet).length).toBeGreaterThan(0);
    void i;
  });
});
