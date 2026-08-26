import { describe, expect, it } from 'vitest';
import { findOverlaps, findTariff, isValidOn, normaliseClass, pickValid, tariffHistory } from './tariffs.js';
import { findSurchargeRate, findZoneRate, matchesTextually, pointInPolygon, resolveZone, zoneCharges } from './taxes.js';
import { buildLegs, measureLegs, summariseLegs } from './tripKm.js';
import { calculateTpo, summariseCharges } from './tpo.js';

// ---------------------------------------------------------------- tariffs

describe('tariff validity', () => {
  const rates = [
    { id: 'a', vehicle_class: '10t', km_rate: 1.80, trip_rate: 500, valid_from: '2026-01-01', valid_to: '2026-06-30' },
    { id: 'b', vehicle_class: '10t', km_rate: 1.95, trip_rate: 520, valid_from: '2026-07-01', valid_to: null },
  ];

  it('picks the rate in force on the date, not the newest one', () => {
    expect(findTariff(rates, { vehicleClass: '10t', onDate: '2026-03-15' })?.km_rate).toBe(1.80);
    expect(findTariff(rates, { vehicleClass: '10t', onDate: '2026-09-15' })?.km_rate).toBe(1.95);
  });

  it('includes both boundary days of a period', () => {
    expect(isValidOn(rates[0], '2026-01-01')).toBe(true);
    expect(isValidOn(rates[0], '2026-06-30')).toBe(true);
    expect(isValidOn(rates[0], '2026-07-01')).toBe(false);
  });

  it('treats an open end as never expiring', () => {
    expect(isValidOn(rates[1], '2099-01-01')).toBe(true);
  });

  it('returns nothing before any contract existed', () => {
    expect(findTariff(rates, { vehicleClass: '10t', onDate: '2025-12-31' })).toBeNull();
  });

  it('does not fall back to another class', () => {
    expect(findTariff(rates, { vehicleClass: '20t', onDate: '2026-03-15' })).toBeNull();
  });

  it('uses a class-less tariff as the catch-all', () => {
    const withDefault = [...rates, { id: 'c', vehicle_class: null, km_rate: 1.5, valid_from: '2026-01-01' }];
    expect(findTariff(withDefault, { vehicleClass: '20t', onDate: '2026-03-15' })?.id).toBe('c');
  });

  it('normalises class spelling', () => {
    expect(normaliseClass('10 T')).toBe(normaliseClass('10t'));
    expect(findTariff(rates, { vehicleClass: '10 T', onDate: '2026-03-15' })?.id).toBe('a');
  });

  it('prefers the most recently started period when two overlap', () => {
    const overlapping = [
      { id: 'old', vehicle_class: '10t', km_rate: 1.8, valid_from: '2026-01-01', valid_to: null },
      { id: 'new', vehicle_class: '10t', km_rate: 1.95, valid_from: '2026-07-01', valid_to: null },
    ];
    expect(pickValid(overlapping, '2026-08-01')?.id).toBe('new');
  });

  it('reports overlapping periods so a forgotten end date is visible', () => {
    const overlapping = [
      { id: 'old', vehicle_class: '10t', valid_from: '2026-01-01', valid_to: null },
      { id: 'new', vehicle_class: '10t', valid_from: '2026-07-01', valid_to: null },
    ];
    expect(findOverlaps(overlapping)).toHaveLength(1);
    expect(findOverlaps(rates)).toHaveLength(0);
  });

  it('lists history newest first', () => {
    expect(tariffHistory(rates, '10t').map((r) => r.id)).toEqual(['b', 'a']);
  });
});

// ---------------------------------------------------------------- zones

describe('zone matching', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[26.0, 44.4], [26.2, 44.4], [26.2, 44.5], [26.0, 44.5], [26.0, 44.4]]],
  };
  const zones = [
    { id: 'za', code: 'ZA', name: 'Zona A', priority: 10, polygon: square, matcher: {}, is_active: true },
    { id: 'zif', code: 'IF', name: 'Ilfov', priority: 1, matcher: { counties: ['IF'] }, is_active: true },
  ];

  it('places a point inside the polygon', () => {
    expect(pointInPolygon({ latitude: 44.45, longitude: 26.1 }, square)).toBe(true);
    expect(pointInPolygon({ latitude: 44.30, longitude: 26.1 }, square)).toBe(false);
  });

  it('resolves by polygon when the place is geocoded', () => {
    expect(resolveZone(zones, { latitude: 44.45, longitude: 26.1, county: 'IF' })?.code).toBe('ZA');
  });

  it('falls back to the county matcher when there are no coordinates', () => {
    expect(resolveZone(zones, { county: 'IF' })?.code).toBe('IF');
  });

  it('matches a city name ignoring diacritics', () => {
    const city = [{ id: 'c', code: 'B', name: 'București', matcher: { cities: ['bucuresti'] }, is_active: true }];
    expect(matchesTextually(city[0], { city: 'Bucureşti' })).toBe(true);
  });

  it('returns nothing when no zone applies', () => {
    expect(resolveZone(zones, { county: 'CJ' })).toBeNull();
  });

  it('ignores inactive zones', () => {
    const off = zones.map((z) => ({ ...z, is_active: false }));
    expect(resolveZone(off, { county: 'IF' })).toBeNull();
  });
});

describe('zone rates by MMA', () => {
  const rates = [
    { id: 'small', mma_min_kg: 0, mma_max_kg: 3500, amount: 0, valid_from: '2026-01-01' },
    { id: 'mid', mma_min_kg: 3501, mma_max_kg: 12000, amount: 45, valid_from: '2026-01-01' },
    { id: 'big', mma_min_kg: 12001, mma_max_kg: null, amount: 75, valid_from: '2026-01-01' },
  ];

  it('charges on MMA from the registration, not on the cargo class', () => {
    // A "10t" truck with an MMA of 19t falls in the big bracket.
    expect(findZoneRate(rates, { mmaKg: 19000, onDate: '2026-03-01' })?.amount).toBe(75);
  });

  it('picks the bracket the MMA falls in', () => {
    expect(findZoneRate(rates, { mmaKg: 3500, onDate: '2026-03-01' })?.id).toBe('small');
    expect(findZoneRate(rates, { mmaKg: 3501, onDate: '2026-03-01' })?.id).toBe('mid');
  });

  it('returns nothing without an MMA rather than guessing a bracket', () => {
    expect(findZoneRate(rates, { mmaKg: null, onDate: '2026-03-01' })).toBeNull();
  });

  it('prefers the narrowest matching bracket', () => {
    const withCatchAll = [...rates, { id: 'any', mma_min_kg: 0, mma_max_kg: null, amount: 999, valid_from: '2026-01-01' }];
    expect(findZoneRate(withCatchAll, { mmaKg: 19000, onDate: '2026-03-01' })?.id).toBe('big');
  });
});

describe('zoneCharges', () => {
  const zones = [{ id: 'zb', code: 'ZB', name: 'Zona B', matcher: { counties: ['IF'] }, is_active: true }];
  const rateMap = new Map([['zb', [{ mma_min_kg: 0, mma_max_kg: null, amount: 60, valid_from: '2026-01-01' }]]]);

  it('charges a zone once even when two stops fall in it', () => {
    const charges = zoneCharges(zones, rateMap, [{ county: 'IF' }, { county: 'IF' }], { mmaKg: 19000, onDate: '2026-03-01' });
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBe(60);
  });

  it('flags a zone that has no valid rate instead of charging zero silently', () => {
    const empty = new Map([['zb', []]]);
    const charges = zoneCharges(zones, empty, [{ county: 'IF' }], { mmaKg: 19000, onDate: '2026-03-01' });
    expect(charges[0]).toMatchObject({ amount: 0, missingRate: true });
  });

  it('charges nothing when no stop is in a zone', () => {
    expect(zoneCharges(zones, rateMap, [{ county: 'CJ' }], { mmaKg: 19000, onDate: '2026-03-01' })).toEqual([]);
  });
});

describe('surcharge rates', () => {
  const rates = [
    { id: 'any', vehicle_class: null, amount: 100, valid_from: '2026-01-01' },
    { id: '20t', vehicle_class: '20t', amount: 180, valid_from: '2026-01-01' },
  ];

  it('uses the class-specific rate when there is one', () => {
    expect(findSurchargeRate(rates, { vehicleClass: '20t', onDate: '2026-03-01' })?.amount).toBe(180);
  });

  it('falls back to the catch-all rate', () => {
    expect(findSurchargeRate(rates, { vehicleClass: '10t', onDate: '2026-03-01' })?.amount).toBe(100);
  });
});

// ---------------------------------------------------------------- kilometres

describe('trip legs', () => {
  const depot = { label: 'Garaj', latitude: 44.4, longitude: 26.1 };
  const loading = { label: 'Încărcare', latitude: 44.5, longitude: 26.0 };
  const drop1 = { label: 'Descărcare 1', latitude: 44.6, longitude: 25.9 };
  const drop2 = { label: 'Descărcare 2', latitude: 44.7, longitude: 25.8 };

  it('builds the full round trip, not just loading to unloading', () => {
    const legs = buildLegs(depot, loading, [drop1]);
    expect(legs.map((l) => l.kind)).toEqual(['depot_to_loading', 'loading_to_unloading', 'unloading_to_depot']);
  });

  it('chains every unloading point', () => {
    const legs = buildLegs(depot, loading, [drop1, drop2]);
    expect(legs.map((l) => l.kind)).toEqual([
      'depot_to_loading', 'loading_to_unloading', 'between_unloading', 'unloading_to_depot',
    ]);
  });

  it('numbers legs in driving order', () => {
    expect(buildLegs(depot, loading, [drop1, drop2]).map((l) => l.seq)).toEqual([1, 2, 3, 4]);
  });

  it('omits depot legs when no depot is configured', () => {
    expect(buildLegs(null, loading, [drop1]).map((l) => l.kind)).toEqual(['loading_to_unloading']);
  });

  it('sums the example from the brief: 35 + 82 + 41 = 158', async () => {
    const distances = [35, 82, 41];
    let i = 0;
    const route = async () => ({ distance_km: distances[i++], duration_min: 30 });
    const measured = await measureLegs(buildLegs(depot, loading, [drop1]), { route });
    expect(summariseLegs(measured)).toMatchObject({ distance_km: 158, complete: true });
  });

  it('marks the total incomplete rather than dropping an unmeasurable leg', async () => {
    const route = async () => { throw new Error('OSRM down'); };
    const measured = await measureLegs(buildLegs(depot, loading, [drop1]), { route });
    expect(summariseLegs(measured)).toMatchObject({ distance_km: 0, complete: false, missing_legs: 3 });
  });

  it('skips a leg whose endpoint is not geocoded', async () => {
    const route = async () => ({ distance_km: 10, duration_min: 10 });
    const legs = buildLegs(depot, { label: 'Fără pin' }, [drop1]);
    const measured = await measureLegs(legs, { route });
    expect(measured[0].reason).toBe('fara_coordonate');
    expect(summariseLegs(measured).complete).toBe(false);
  });
});

// ---------------------------------------------------------------- TPO

describe('calculateTpo', () => {
  const vehicle = { vehicle_class: '10t', mma_kg: 19000 };
  const tariffs = [{ id: 't1', vehicle_class: '10t', trip_rate: 500, km_rate: 1.0, valid_from: '2026-01-01' }];
  const zones = [{ id: 'zb', code: 'ZB', name: 'Zona B', matcher: { counties: ['IF'] }, is_active: true }];
  const zoneRates = new Map([['zb', [{ mma_min_kg: 12001, mma_max_kg: null, amount: 75, valid_from: '2026-01-01' }]]]);
  const crane = {
    type: { id: 's1', code: 'DM', name: 'Taxă macara', applies_per: 'trip' },
    rates: [{ vehicle_class: '10t', amount: 120, valid_from: '2026-01-01' }],
  };

  const base = {
    trip: { loading_date: '2026-03-10' },
    vehicle,
    tariffs,
    kmSummary: { distance_km: 280, complete: true },
    zones,
    zoneRates,
    places: [{ county: 'IF' }],
    surcharges: [crane],
  };

  it('reproduces the worked example from the brief', () => {
    const result = calculateTpo(base);
    expect(summariseCharges(result.lines)).toEqual({
      trip_rate: 500, km_rate: 280, zone_tax: 75, surcharge: 120,
    });
    expect(result.total).toBe(975);
  });

  it('keeps every component separate, not just the total', () => {
    const result = calculateTpo(base);
    expect(result.lines.map((l) => l.kind)).toEqual(['trip_rate', 'km_rate', 'zone_tax', 'surcharge']);
    expect(result.lines.every((l) => l.amount != null)).toBe(true);
  });

  it('uses the rate valid at the trip date, not today', () => {
    const twoPeriods = [
      { id: 'a', vehicle_class: '10t', trip_rate: 500, km_rate: 1.80, valid_from: '2026-01-01', valid_to: '2026-06-30' },
      { id: 'b', vehicle_class: '10t', trip_rate: 500, km_rate: 1.95, valid_from: '2026-07-01' },
    ];
    const march = calculateTpo({ ...base, tariffs: twoPeriods, kmSummary: { distance_km: 100, complete: true } });
    const august = calculateTpo({
      ...base, tariffs: twoPeriods, trip: { loading_date: '2026-08-10' },
      kmSummary: { distance_km: 100, complete: true },
    });
    expect(march.lines.find((l) => l.kind === 'km_rate').amount).toBe(180);
    expect(august.lines.find((l) => l.kind === 'km_rate').amount).toBe(195);
  });

  it('taxes on MMA, not on the commercial class', () => {
    const result = calculateTpo(base);
    const zoneLine = result.lines.find((l) => l.kind === 'zone_tax');
    expect(zoneLine.detail.mma_kg).toBe(19000);
    expect(zoneLine.amount).toBe(75);
  });

  it('charges no crane fee when the trip does not need one', () => {
    const result = calculateTpo({ ...base, surcharges: [] });
    expect(result.lines.some((l) => l.kind === 'surcharge')).toBe(false);
    expect(result.total).toBe(855);
  });

  it('warns instead of inventing a price when no tariff is valid', () => {
    const result = calculateTpo({ ...base, tariffs: [] });
    expect(result.warnings.map((w) => w.code)).toContain('fara_tarif');
    expect(result.lines.some((l) => l.kind === 'trip_rate')).toBe(false);
  });

  it('warns when the vehicle has no MMA, because the zone tax depends on it', () => {
    const result = calculateTpo({ ...base, vehicle: { vehicle_class: '10t', mma_kg: null } });
    expect(result.warnings.map((w) => w.code)).toContain('fara_mma');
  });

  it('warns when the kilometres are incomplete', () => {
    const result = calculateTpo({ ...base, kmSummary: { distance_km: 100, complete: false, missing_legs: 2 } });
    expect(result.warnings.map((w) => w.code)).toContain('km_incompleti');
  });

  it('applies a contractual minimum distance', () => {
    const withMin = [{ ...tariffs[0], min_km: 50 }];
    const result = calculateTpo({ ...base, tariffs: withMin, kmSummary: { distance_km: 12, complete: true } });
    const km = result.lines.find((l) => l.kind === 'km_rate');
    expect(km.quantity).toBe(50);
    expect(km.detail).toMatchObject({ driven_km: 12, billed_km: 50 });
  });

  it('carries manual charges through into the total', () => {
    const result = calculateTpo({
      ...base,
      trip: { loading_date: '2026-03-10', manual_charges: [{ label: 'Staționare', amount: 50 }] },
    });
    expect(result.total).toBe(1025);
    expect(result.lines.find((l) => l.kind === 'manual').source).toBe('manual');
  });

  it('records the basis so the figure can be audited later', () => {
    expect(calculateTpo(base).basis).toMatchObject({
      on_date: '2026-03-10', vehicle_class: '10t', mma_kg: 19000, distance_km: 280,
    });
  });

  it('totals exactly the sum of its lines', () => {
    const result = calculateTpo(base);
    const sum = result.lines.reduce((n, l) => n + l.amount, 0);
    expect(result.total).toBe(Math.round(sum * 100) / 100);
  });
});

describe('date handling across sources', () => {
  // pg returns DATE columns as Date objects; the API returns ISO strings. Both must work,
  // or tariffs silently never match when the rows come straight from the database.
  const asDates = [{
    id: 'a', vehicle_class: '10t', trip_rate: 500, km_rate: 1.8,
    valid_from: new Date(2026, 0, 1), valid_to: new Date(2026, 5, 30),
  }];

  it('matches a tariff whose validity arrived as Date objects', () => {
    expect(findTariff(asDates, { vehicleClass: '10t', onDate: '2026-03-15' })?.id).toBe('a');
  });

  it('still respects the end of the period', () => {
    expect(findTariff(asDates, { vehicleClass: '10t', onDate: '2026-07-01' })).toBeNull();
  });

  it('accepts a Date as the query date too', () => {
    expect(isValidOn(asDates[0], new Date(2026, 2, 15))).toBe(true);
  });

  it('does not slip a midnight date to the previous day', () => {
    const midnight = [{ id: 'm', vehicle_class: '10t', km_rate: 1, valid_from: new Date(2026, 2, 10) }];
    expect(isValidOn(midnight[0], '2026-03-10')).toBe(true);
  });
});
