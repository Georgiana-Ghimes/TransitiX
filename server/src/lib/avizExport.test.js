import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderReportWorkbook } from './avizExport.js';
import { buildReport } from './reporting/build.js';
import {
  ANNEX_SOURCE_KEYS,
  DEFAULT_RAI_COLUMNS,
  annexFieldDefaults,
  isCompleteRaiTemplate,
  normalizeTemplateColumns,
  resolveExportColumns,
} from './avizTemplate.js';

const EXTRACTED_AVIZ = {
  ...annexFieldDefaults(),
  numar_tpo: 'TPO-0025803',
  data_efectuare_cursa: '2026-08-11',
  numar_auto: 'B-34-BAU',
  ruta_transport: 'Bucuresti/Aeroportului120-T-Bucuresti/Viilor52',
  tip_marfa: 'saci',
  cantitate_marfa: 378,
  numar_document_marfa: 'PSL-0044633',
};

const DUAL_PLATE_AVIZ = {
  ...annexFieldDefaults(),
  numar_tpo: 'TPO-0025813',
  data_efectuare_cursa: '2026-08-11',
  numar_auto: 'B-112-VFM / B-475-AGR',
  ruta_transport: 'Mil-Bucuresti/IuliuManiu600A',
  tip_marfa: 'galeti',
  cantitate_marfa: 768,
  numar_document_marfa: 'TRO-0008053',
};

/** User's custom template: no Nr. crt, Taxă 100, Tarif km 20. */
function sablonNouColumns() {
  return DEFAULT_RAI_COLUMNS
    .filter((col) => col.source !== 'nr_crt')
    .map((col) => {
      if (col.source === 'taxe_suplimentare') return { ...col, default_value: '100' };
      if (col.source === 'tarif_km') return { ...col, default_value: '20' };
      return { ...col };
    });
}

/** The same two calls the export route makes, so the tests guard the real path. */
function annexWorkbook(template, avize) {
  return renderReportWorkbook({
    name: template.name || 'Anexa',
    columns: normalizeTemplateColumns(template.columns),
    rows: buildReport({ template, documents: avize }).rows,
    totals: null,
  });
}

async function loadSheet(template, avize) {
  const built = annexWorkbook(template, avize);
  const buffer = await built.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return loaded.worksheets[0];
}

function tableFromSheet(sheet) {
  const colCount = Math.max(sheet.columnCount, sheet.actualColumnCount, 1);
  const headers = [];
  for (let c = 1; c <= colCount; c += 1) {
    const value = sheet.getRow(1).getCell(c).value;
    if (value == null || value === '') break;
    headers.push(String(value));
  }
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    if (r > 1 && sheet.getRow(r).cellCount === 0) continue;
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = sheet.getRow(r).getCell(i + 1).value;
    });
    rows.push(obj);
  }
  return { headers, rows };
}

describe('resolveExportColumns', () => {
  it('uses the 14 RAI columns when the template has no columns', () => {
    const cols = resolveExportColumns({ name: 'empty', columns: [] });
    expect(cols).toHaveLength(14);
    expect(cols.map((c) => c.source)).toEqual(ANNEX_SOURCE_KEYS);
  });

  it('does not replace a custom template that is missing Nr. crt', () => {
    const columns = sablonNouColumns();
    expect(isCompleteRaiTemplate(columns)).toBe(false);
    const resolved = resolveExportColumns({ name: 'Șablon nou', columns });
    expect(resolved).toHaveLength(13);
    expect(resolved[0].source).toBe('numar_tpo');
    expect(resolved.find((c) => c.source === 'taxe_suplimentare').default_value).toBe('100');
    expect(resolved.find((c) => c.source === 'tarif_km').default_value).toBe('20');
  });
});

describe('anexa exportată — default Anexa Factura RAI', () => {
  it('writes all 14 headers and extracted fields into the xlsx', async () => {
    const sheet = await loadSheet({ name: 'Anexa Factura RAI', columns: DEFAULT_RAI_COLUMNS }, [EXTRACTED_AVIZ]);
    const { headers, rows } = tableFromSheet(sheet);

    expect(headers).toEqual(DEFAULT_RAI_COLUMNS.map((c) => c.header));
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row['Nr. crt']).toBe(1);
    expect(row['Numar TPO']).toBe('TPO-0025803');
    expect(row['Data efectuare cursa']).toBe('11.08.2026');
    expect(row['Valoare TPO']).toBe(0);
    expect(row['Numar auto']).toBe('B-34-BAU');
    expect(row['Ruta transport']).toBe('Bucuresti/Aeroportului120-T-Bucuresti/Viilor52');
    expect(row['Tip marfa']).toBe('saci');
    expect(row['Cantitate marfa (t/m3/galeti)']).toBe(378);
    expect(row['Numar document marfa (aviz/factura)']).toBe('PSL-0044633');
    expect(row['Numar curse']).toBe(1);
    expect(row['Taxa suplimentara']).toBe(0);
    expect(row['Km parcursi']).toBe(0);
    expect(row['Tarif km']).toBe(0);
    expect(row['Observatii'] ?? '').toBe('');
  });

  it('numbers two avize and keeps tractor + trailer plates', async () => {
    const sheet = await loadSheet(
      { name: 'Anexa Factura RAI', columns: DEFAULT_RAI_COLUMNS },
      [EXTRACTED_AVIZ, DUAL_PLATE_AVIZ]
    );
    const { rows } = tableFromSheet(sheet);
    expect(rows[0]['Nr. crt']).toBe(1);
    expect(rows[1]['Nr. crt']).toBe(2);
    expect(rows[1]['Numar TPO']).toBe('TPO-0025813');
    expect(rows[1]['Numar auto']).toBe('B-112-VFM / B-475-AGR');
    expect(rows[1]['Ruta transport']).toBe('Mil-Bucuresti/IuliuManiu600A');
    expect(rows[1]['Tip marfa']).toBe('galeti');
    expect(rows[1]['Cantitate marfa (t/m3/galeti)']).toBe(768);
    expect(rows[1]['Numar document marfa (aviz/factura)']).toBe('TRO-0008053');
  });

  it('paints yellow headers and names the sheet after the template', async () => {
    const sheet = await loadSheet({ name: 'Anexa Factura RAI', columns: DEFAULT_RAI_COLUMNS }, [EXTRACTED_AVIZ]);
    expect(sheet.name).toBe('Anexa Factura RAI');
    const fill = sheet.getRow(1).getCell(1).fill;
    expect(fill?.fgColor?.argb).toBe('FFFFFF00');
  });
});

describe('anexa exportată — custom Șablon nou defaults', () => {
  it('writes Taxa 100 and Tarif km 20 when aviz fields are still 0', async () => {
    const sheet = await loadSheet({ name: 'Șablon nou', columns: sablonNouColumns() }, [EXTRACTED_AVIZ]);
    const { headers, rows } = tableFromSheet(sheet);

    expect(headers).not.toContain('Nr. crt');
    expect(headers[0]).toBe('Numar TPO');
    expect(headers).toContain('Taxa suplimentara');
    expect(headers).toContain('Tarif km');

    expect(rows[0]['Numar TPO']).toBe('TPO-0025803');
    expect(rows[0]['Taxa suplimentara']).toBe(100);
    expect(rows[0]['Tarif km']).toBe(20);
    expect(rows[0]['Km parcursi']).toBe(0);
    expect(rows[0]['Valoare TPO']).toBe(0);
    expect(rows[0]['Numar curse']).toBe(1);
    expect(rows[0]['Numar auto']).toBe('B-34-BAU');
    expect(rows[0]['Ruta transport']).toBe('Bucuresti/Aeroportului120-T-Bucuresti/Viilor52');
  });

  it('keeps per-aviz tax/tarif/km/valoare when they are not zero', async () => {
    const filled = {
      ...EXTRACTED_AVIZ,
      valoare_tpo: 450,
      taxe_suplimentare: 40,
      km_parcursi: 32.5,
      tarif_km: 15,
      observatii: 'IF*',
    };
    const sheet = await loadSheet({ name: 'Șablon nou', columns: sablonNouColumns() }, [filled]);
    const { rows } = tableFromSheet(sheet);
    expect(rows[0]['Valoare TPO']).toBe(450);
    expect(rows[0]['Taxa suplimentara']).toBe(40);
    expect(rows[0]['Km parcursi']).toBe(32.5);
    expect(rows[0]['Tarif km']).toBe(15);
    expect(rows[0]['Observatii']).toBe('IF*');
  });

  it('applies defaults only on unset rows in a mixed export', async () => {
    const edited = { ...DUAL_PLATE_AVIZ, taxe_suplimentare: 40, tarif_km: 15 };
    const sheet = await loadSheet(
      { name: 'Șablon nou', columns: sablonNouColumns() },
      [EXTRACTED_AVIZ, edited]
    );
    const { rows } = tableFromSheet(sheet);
    expect(rows[0]['Taxa suplimentara']).toBe(100);
    expect(rows[0]['Tarif km']).toBe(20);
    expect(rows[1]['Taxa suplimentara']).toBe(40);
    expect(rows[1]['Tarif km']).toBe(15);
    expect(rows[1]['Numar auto']).toBe('B-112-VFM / B-475-AGR');
  });

  it('applies Default on km, valoare TPO, observatii, and a constant column', async () => {
    const columns = [
      ...sablonNouColumns().map((col) => {
        if (col.source === 'km_parcursi') return { ...col, default_value: '50' };
        if (col.source === 'valoare_tpo') return { ...col, default_value: '250' };
        if (col.source === 'observatii') return { ...col, default_value: 'Z:B*' };
        return col;
      }),
      { header: 'Notă fixă', source: '', default_value: 'RAI' },
    ];
    const sheet = await loadSheet({ name: 'Șablon nou', columns }, [EXTRACTED_AVIZ]);
    const { rows } = tableFromSheet(sheet);
    expect(rows[0]['Km parcursi']).toBe(50);
    expect(rows[0]['Valoare TPO']).toBe(250);
    expect(rows[0]['Observatii']).toBe('Z:B*');
    expect(rows[0]['Notă fixă']).toBe('RAI');
    expect(rows[0]['Taxa suplimentara']).toBe(100);
    expect(rows[0]['Tarif km']).toBe(20);
  });

  it('round-trips custom defaults through an xlsx buffer the same way Unește downloads', async () => {
    const built = annexWorkbook(
      { name: 'Șablon nou', columns: sablonNouColumns() },
      [EXTRACTED_AVIZ]
    );
    const buffer = Buffer.from(await built.xlsx.writeBuffer());
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    const { rows, headers } = tableFromSheet(loaded.worksheets[0]);
    expect(headers).toHaveLength(13);
    expect(rows[0]['Taxa suplimentara']).toBe(100);
    expect(rows[0]['Tarif km']).toBe(20);
  });
});
