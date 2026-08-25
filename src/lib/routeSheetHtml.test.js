import { describe, expect, it } from 'vitest';
import { buildRouteSheet, paginateSheetRows } from './routeSheet.js';
import { escapeHtml, sheetPageHtml } from './routeSheetHtml.js';

function makeSheet(stopCount, extra = {}) {
  const stops = Array.from({ length: stopCount }, (_, i) => ({
    id: `s${i}`,
    seq: i + 1,
    kind: 'livrare',
    location_name: `Oprirea ${i + 1}`,
    address_full: 'str. Republicii 1, Oradea, BH',
    planned_arrival: '2026-08-27T06:30:00.000Z',
  }));
  return buildRouteSheet({
    route: { code: 'R-01', route_date: '2026-08-27', driver_name: 'Ion Popescu' },
    stops,
    totals: { stops: stopCount, complete: true },
    ...extra,
  }, { company: { name: 'Transitix SRL' } });
}

describe('escapeHtml', () => {
  it('neutralises markup coming from stored data', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('leaves Romanian diacritics untouched', () => {
    expect(escapeHtml('Timișoara, paleți')).toBe('Timișoara, paleți');
  });
});

describe('sheetPageHtml', () => {
  it('prints the header, every column and every row', () => {
    const sheet = makeSheet(3);
    const html = sheetPageHtml(sheet, sheet.rows, 0, 1);
    expect(html).toContain('FOAIE DE PARCURS');
    expect(html).toContain('Transitix SRL');
    expect(html).toContain('Ion Popescu');
    for (const column of sheet.columns) expect(html).toContain(column.label);
    for (const row of sheet.rows) expect(html).toContain(row.name);
  });

  it('puts the signature block only on the last page', () => {
    const sheet = makeSheet(20);
    const pages = paginateSheetRows(sheet.rows);
    expect(pages).toHaveLength(2);
    expect(sheetPageHtml(sheet, pages[0], 0, 2)).not.toContain('Km plecare');
    expect(sheetPageHtml(sheet, pages[1], 1, 2)).toContain('Km plecare');
  });

  it('numbers the pages only when there is more than one', () => {
    const sheet = makeSheet(20);
    const pages = paginateSheetRows(sheet.rows);
    expect(sheetPageHtml(sheet, pages[0], 0, 2)).toContain('pagina 1/2');
    expect(sheetPageHtml(makeSheet(2), makeSheet(2).rows, 0, 1)).not.toContain('pagina');
  });

  it('says so instead of drawing an empty grid when there are no stops', () => {
    const sheet = makeSheet(0);
    expect(sheetPageHtml(sheet, [], 0, 1)).toContain('Ruta nu are opriri planificate');
  });

  it('escapes a location name that contains markup', () => {
    const sheet = makeSheet(1);
    sheet.rows[0].name = '<script>x</script>';
    const html = sheetPageHtml(sheet, sheet.rows, 0, 1);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('prints the warnings the dispatcher would otherwise keep to themselves', () => {
    const sheet = makeSheet(1);
    sheet.warnings = ['Oprirea 1 depășește intervalul cu 20 min'];
    expect(sheetPageHtml(sheet, sheet.rows, 0, 1)).toContain('depășește intervalul');
  });
});

describe('paginateSheetRows', () => {
  it('splits at twelve rows a page', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ seq: i }));
    expect(paginateSheetRows(rows).map((p) => p.length)).toEqual([12, 12, 1]);
  });

  it('returns one empty page for a route with no stops', () => {
    expect(paginateSheetRows([])).toEqual([[]]);
  });
});
