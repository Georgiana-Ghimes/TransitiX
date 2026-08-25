import { describe, expect, it } from 'vitest';
import {
  buildImportPlan,
  indexClients,
  indexLocations,
  mapHeaders,
  matchLocation,
  parseDelimited,
  parseImportDate,
  parseImportRow,
  parseImportTime,
  parseNumber,
  parseOrderType,
  parseRequires,
} from './orderImport.js';

describe('parseDelimited', () => {
  it('sniffs the semicolon a Romanian Excel export uses', () => {
    const rows = parseDelimited('Numar comanda;Locatie;Greutate\nCMD-1;Depozit;1,5');
    expect(rows).toEqual([
      ['Numar comanda', 'Locatie', 'Greutate'],
      ['CMD-1', 'Depozit', '1,5'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const rows = parseDelimited('nr,adresa\n"CMD-1","Cluj-Napoca, str. Fabricii 12"');
    expect(rows[1]).toEqual(['CMD-1', 'Cluj-Napoca, str. Fabricii 12']);
  });

  it('handles doubled quotes, CRLF and a BOM', () => {
    const rows = parseDelimited('\uFEFFnr,marfa\r\nCMD-1,"palet ""euro"" 120"\r\n');
    expect(rows[1]).toEqual(['CMD-1', 'palet "euro" 120']);
  });

  it('drops blank lines instead of importing empty orders', () => {
    expect(parseDelimited('a,b\n\n1,2\n   ,  \n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('mapHeaders', () => {
  it('matches Romanian headers with diacritics and spacing noise', () => {
    const { fields } = mapHeaders(['Număr comandă', ' Locație ', 'Greutate (kg)', 'Paleți']);
    expect(fields.order_number).toBe(0);
    expect(fields.location_name).toBe(1);
    expect(fields.weight_kg).toBe(2);
    expect(fields.pallets).toBe(3);
  });

  it('reports unknown columns rather than dropping them silently', () => {
    const { fields, unknown } = mapHeaders(['nr', 'cod intern']);
    expect(fields.order_number).toBe(0);
    expect(unknown).toEqual(['cod intern']);
  });

  it('keeps the first of two columns claiming the same field', () => {
    const { fields, duplicates } = mapHeaders(['nr comanda', 'numar comanda']);
    expect(fields.order_number).toBe(0);
    expect(duplicates).toEqual(['numar comanda']);
  });
});

describe('parseNumber', () => {
  it('reads Romanian and English decimals', () => {
    expect(parseNumber('1234,56')).toBe(1234.56);
    expect(parseNumber('1234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
  });

  it('treats a lone dot with three digits as thousands', () => {
    expect(parseNumber('1.500')).toBe(1500);
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber('1.50')).toBe(1.5);
  });

  it('strips units and returns null for junk', () => {
    expect(parseNumber('1200 kg')).toBe(1200);
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it('does not turn a missing value into zero', () => {
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(0)).toBe(0);
  });
});

describe('parseImportDate', () => {
  it('reads day-first Romanian dates', () => {
    expect(parseImportDate('03.04.2026')).toBe('2026-04-03');
    expect(parseImportDate('3/4/26')).toBe('2026-04-03');
  });

  it('reads ISO and real Date cells', () => {
    expect(parseImportDate('2026-08-27')).toBe('2026-08-27');
    expect(parseImportDate(new Date(2026, 7, 27))).toBe('2026-08-27');
  });

  it('reads an Excel serial', () => {
    expect(parseImportDate(46261)).toBe('2026-08-27');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseImportDate('31.02.2026')).toBeNull();
    expect(parseImportDate('maine')).toBeNull();
  });
});

describe('parseImportTime', () => {
  it('accepts bare hours and HH:MM', () => {
    expect(parseImportTime('8')).toBe('08:00');
    expect(parseImportTime('08:30')).toBe('08:30');
    expect(parseImportTime('16:45:00')).toBe('16:45');
  });

  it('rejects out-of-range clock values', () => {
    expect(parseImportTime('25:00')).toBeNull();
    expect(parseImportTime('08:70')).toBeNull();
  });
});

describe('parseRequires / parseOrderType', () => {
  it('splits requirement lists on any common separator', () => {
    expect(parseRequires('ADR, frigo; lift-hidraulic')).toEqual(['ADR', 'frigo', 'lift-hidraulic']);
    expect(parseRequires('')).toEqual([]);
  });

  it('maps type synonyms and defaults to delivery', () => {
    expect(parseOrderType('Livrare')).toBe('livrare');
    expect(parseOrderType('pickup')).toBe('ridicare');
    expect(parseOrderType('')).toBe('livrare');
  });

  it('returns null for a type it does not know', () => {
    expect(parseOrderType('retur')).toBeNull();
  });
});

const LOCATIONS = [
  { id: 'loc-1', name: 'Depozit Cluj', address: 'Cluj-Napoca, str. Fabricii 12', latitude: 46.7, longitude: 23.5 },
  { id: 'loc-2', name: 'Magazin Centru', address: 'Timisoara, Calea Aradului 50' },
  { id: 'loc-3', name: 'Depozit', address: 'Oradea, str. Republicii 1' },
  { id: 'loc-4', name: 'Depozit', address: 'Arad, str. Mihai Viteazu 3' },
];

describe('matchLocation', () => {
  const index = indexLocations(LOCATIONS);

  it('matches on name', () => {
    expect(matchLocation(index, { location_name: 'depozit cluj' }).location.id).toBe('loc-1');
  });

  it('matches on address even when the city sits in its own column', () => {
    const hit = matchLocation(index, { address: 'Calea Aradului 50', city: 'Timisoara' });
    expect(hit.location.id).toBe('loc-2');
    expect(hit.reason).toBe('adresa');
  });

  it('refuses a name that two locations share', () => {
    const hit = matchLocation(index, { location_name: 'Depozit' });
    expect(hit.location).toBeNull();
    expect(hit.reason).toBe('nume_ambiguu');
  });

  it('reports a missing location instead of inventing one', () => {
    expect(matchLocation(index, { location_name: 'Depozit Iasi' }).reason).toBe('negasit');
    expect(matchLocation(index, {}).reason).toBe('lipsa');
  });
});

describe('parseImportRow', () => {
  const ctx = {
    fields: mapHeaders(['nr comanda', 'locatie', 'data', 'greutate', 'de la', 'pana la']).fields,
    locationIndex: indexLocations(LOCATIONS),
    clientIndex: indexClients([{ id: 'cli-1', name: 'S.C. Alfa S.R.L.' }]),
    defaultDate: '2026-08-27',
  };

  it('builds an order from a clean line', () => {
    const row = ['CMD-1', 'Depozit Cluj', '27.08.2026', '1.500', '08:00', '12:00'];
    const result = parseImportRow(row, ctx);
    expect(result.errors).toEqual([]);
    expect(result.order).toMatchObject({
      order_number: 'CMD-1',
      location_id: 'loc-1',
      requested_date: '2026-08-27',
      weight_kg: 1500,
      window_start: '08:00',
      window_end: '12:00',
      type: 'livrare',
    });
  });

  it('falls back to the chosen date and says so', () => {
    const row = ['CMD-2', 'Depozit Cluj', 'candva', '10'];
    const result = parseImportRow(row, ctx);
    expect(result.order.requested_date).toBe('2026-08-27');
    expect(result.warnings.join(' ')).toMatch(/Data/);
    expect(result.errors).toEqual([]);
  });

  it('blocks a line whose location is unknown', () => {
    const result = parseImportRow(['CMD-3', 'Depozit Iasi', '27.08.2026'], ctx);
    expect(result.order.location_id).toBeNull();
    expect(result.errors.join(' ')).toMatch(/Locația nu există/);
  });

  it('blocks a backwards delivery window', () => {
    const result = parseImportRow(['CMD-4', 'Depozit Cluj', '27.08.2026', '10', '16:00', '09:00'], ctx);
    expect(result.errors.join(' ')).toMatch(/se termină înainte/);
  });

  it('leaves quantities at zero rather than null when the column is absent', () => {
    const result = parseImportRow(['CMD-5', 'Depozit Cluj', '27.08.2026'], ctx);
    expect(result.order.weight_kg).toBe(0);
    expect(result.order.volume_mc).toBe(0);
    expect(result.order.pallets).toBe(0);
  });
});

describe('buildImportPlan', () => {
  const base = {
    locations: LOCATIONS,
    clients: [{ id: 'cli-1', name: 'Alfa' }],
    defaultDate: '2026-08-27',
  };

  it('summarises good and bad lines', () => {
    const rows = [
      ['Numar comanda', 'Locatie', 'Data'],
      ['CMD-1', 'Depozit Cluj', '27.08.2026'],
      ['CMD-2', 'Depozit Iasi', '27.08.2026'],
    ];
    const plan = buildImportPlan(rows, base);
    expect(plan.summary).toMatchObject({ total: 2, ok: 1, errors: 1 });
    expect(plan.rows[0].line).toBe(2);
  });

  it('catches a number that already exists and one repeated in the file', () => {
    const rows = [
      ['Numar comanda', 'Locatie'],
      ['CMD-1', 'Depozit Cluj'],
      ['CMD-1', 'Magazin Centru'],
      ['CMD-9', 'Depozit Cluj'],
    ];
    const plan = buildImportPlan(rows, { ...base, existingNumbers: ['CMD-9'] });
    expect(plan.rows[1].errors.join(' ')).toMatch(/se repetă/);
    expect(plan.rows[2].errors.join(' ')).toMatch(/deja o comandă/);
    expect(plan.summary.ok).toBe(1);
  });

  it('refuses a file with no usable columns', () => {
    const plan = buildImportPlan([['cod', 'cantitate'], ['1', '2']], base);
    expect(plan.fatal).toMatch(/Număr comandă/);
    expect(plan.summary.ok).toBe(0);
  });

  it('returns an empty plan for an empty file', () => {
    expect(buildImportPlan([], base).summary.total).toBe(0);
  });
});
