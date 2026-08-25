import { describe, expect, it } from 'vitest';
import { buildRouteSheet, sheetFilename, sheetWarnings } from './routeSheet.js';

const COMPANY = { name: 'Transitix Logistic SRL', cui: 'RO123', address: 'Cluj-Napoca', phone: '0264' };

const PLAN = {
  route: {
    id: 'r1',
    code: 'R-01',
    route_date: '2026-08-27',
    starts_at: '08:00:00',
    driver_name: 'Ion Popescu',
    vehicle_plate: 'CJ 01 TRX',
  },
  stops: [
    {
      id: 's1',
      seq: 1,
      kind: 'livrare',
      location_name: 'Magazin Profi',
      address_full: 'str. Republicii 1, Oradea, BH',
      order_number: 'CMD-01',
      weight_kg: 1200,
      pallets: 4,
      window_start: '08:00:00',
      window_end: '12:00:00',
      planned_arrival: '2026-08-27T06:30:00.000Z',
    },
    {
      id: 's2',
      seq: 2,
      kind: 'ridicare',
      location_name: 'Depozit Sud',
      address: 'Șoseaua Olteniței 200',
      city: 'București',
      planned_arrival: null,
    },
  ],
  totals: { stops: 2, distance_km: 172.4, duration_min: 195, weight_kg: 1200, pallets: 4, complete: true },
};

describe('buildRouteSheet', () => {
  it('prints the route identity in the header', () => {
    const sheet = buildRouteSheet(PLAN, { company: COMPANY });
    expect(sheet.title).toBe('FOAIE DE PARCURS');
    expect(sheet.company).toBe('Transitix Logistic SRL');
    expect(sheet.routeCode).toBe('R-01');
    expect(sheet.date).toBe('27.08.2026');
  });

  it('summarises driver, vehicle and totals', () => {
    const { meta } = buildRouteSheet(PLAN, { company: COMPANY });
    const byLabel = Object.fromEntries(meta.map((m) => [m.label, m.value]));
    expect(byLabel['Șofer']).toBe('Ion Popescu');
    expect(byLabel.Vehicul).toBe('CJ 01 TRX');
    expect(byLabel.Plecare).toBe('08:00');
    expect(byLabel.Distanță).toBe('172,4 km');
    expect(byLabel.Durată).toBe('3h 15m');
    expect(byLabel['Încărcătură']).toContain('1.200 kg');
  });

  it('builds one row per stop with load and window', () => {
    const { rows } = buildRouteSheet(PLAN, { company: COMPANY });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      seq: '1',
      name: 'Magazin Profi',
      address: 'str. Republicii 1, Oradea, BH',
      order: 'CMD-01',
      load: '1.200 kg / 4 pal',
      window: '08:00–12:00',
    });
  });

  it('composes an address when the server did not', () => {
    const { rows } = buildRouteSheet(PLAN, { company: COMPANY });
    expect(rows[1].address).toBe('Șoseaua Olteniței 200, București');
  });

  it('leaves the estimate blank rather than printing a dash on a signed document', () => {
    const { rows } = buildRouteSheet(PLAN, { company: COMPANY });
    expect(rows[0].eta).toMatch(/^\d{2}:\d{2}$/);
    expect(rows[1].eta).toBe('');
  });

  it('keeps the signature and reading boxes empty', () => {
    const sheet = buildRouteSheet(PLAN, { company: COMPANY });
    expect(sheet.rows.every((r) => r.actual === '' && r.signature === '')).toBe(true);
    expect(sheet.readings.map((r) => r.label)).toContain('Km plecare');
    expect(sheet.signatures).toHaveLength(2);
  });

  it('survives a route with no driver, vehicle or stops', () => {
    const sheet = buildRouteSheet({ route: { code: 'R-09', route_date: '2026-08-27' }, stops: [], totals: {} });
    expect(sheet.rows).toEqual([]);
    expect(sheet.meta.find((m) => m.label === 'Șofer').value).toBe('—');
    expect(sheet.company).toBe('');
  });

  it('names the file after the route and its day', () => {
    expect(sheetFilename({ code: 'R-01' }, '2026-08-27')).toBe('foaie-parcurs-R-01-2026-08-27.pdf');
    expect(sheetFilename({})).toBe('foaie-parcurs-ruta-fara-data.pdf');
  });
});

describe('sheetWarnings', () => {
  it('prints late stops and capacity overflow', () => {
    const warnings = sheetWarnings({
      windowViolations: [{ seq: 3, type: 'intarziere', by_min: 25 }, { seq: 4, type: 'prea_devreme', by_min: 10 }],
      capacityProblems: [{ label: 'greutate', over: 300, unit: 'kg' }],
      totals: { complete: true },
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Oprirea 3');
    expect(warnings[1]).toContain('+300 kg');
  });

  it('says when the estimates are incomplete', () => {
    expect(sheetWarnings({ totals: { complete: false } })[0]).toMatch(/incomplete/);
  });

  it('is empty for a clean plan', () => {
    expect(sheetWarnings({ totals: { complete: true } })).toEqual([]);
  });
});
