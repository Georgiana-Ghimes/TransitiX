import { describe, expect, it } from 'vitest';
import {
  assessCandidates,
  candidatesFromClients,
  candidatesFromTrips,
  dedupeCandidates,
  indexClients,
  matchClientId,
  summarize,
  toLocationRow,
} from './backfill.js';

const CLIENTS = [
  { id: 'c1', name: 'SC Logistics Nord SRL', cui: 'RO99887766', address: 'Cluj-Napoca, str. Fabricii 12', phone: '0264111222' },
  { id: 'c2', name: 'Depozit Sud SA', cui: 'RO11223344', address: 'București, Șoseaua Olteniței 200' },
  { id: 'c3', name: 'Client fără adresă', cui: null, address: '   ' },
];

describe('candidatesFromClients', () => {
  it('takes one candidate per client that actually has an address', () => {
    const candidates = candidatesFromClients(CLIENTS);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ source: 'client', client_id: 'c1', kind: 'client' });
  });

  it('ignores whitespace-only addresses', () => {
    expect(candidatesFromClients([{ id: 'x', name: 'X', address: '\n  ' }])).toEqual([]);
  });
});

describe('client matching', () => {
  const index = indexClients(CLIENTS);

  it('matches on CUI regardless of the RO prefix and spacing', () => {
    expect(matchClientId(index, { cui: '99887766' })).toBe('c1');
    expect(matchClientId(index, { cui: 'RO 99887766' })).toBe('c1');
  });

  it('matches on name ignoring the legal form', () => {
    expect(matchClientId(index, { name: 'Logistics Nord' })).toBe('c1');
    expect(matchClientId(index, { name: 'S.C. LOGISTICS NORD S.R.L.' })).toBe('c1');
  });

  it('prefers CUI over name when they disagree', () => {
    expect(matchClientId(index, { cui: 'RO11223344', name: 'SC Logistics Nord SRL' })).toBe('c2');
  });

  it('returns null for an unknown party', () => {
    expect(matchClientId(index, { name: 'Cineva Nou SRL', cui: 'RO5' })).toBe(null);
  });
});

describe('candidatesFromTrips', () => {
  const trips = [{
    id: 't1',
    shipper_name: 'SC Agro Vest SRL',
    shipper_address: 'Timișoara, Calea Aradului 50',
    consignee_name: 'Depozit Sud SA',
    consignee_address: 'București, Șoseaua Olteniței 200',
    consignee_cui: 'RO11223344',
  }];

  it('yields one candidate per party with an address', () => {
    const candidates = candidatesFromTrips(trips, indexClients(CLIENTS));
    expect(candidates.map((c) => c.source)).toEqual(['trip_shipper', 'trip_consignee']);
  });

  it('links a trip party back to the matching client', () => {
    const candidates = candidatesFromTrips(trips, indexClients(CLIENTS));
    expect(candidates[0].client_id).toBe(null);
    expect(candidates[1].client_id).toBe('c2');
  });

  it('skips parties with no address', () => {
    const candidates = candidatesFromTrips(
      [{ id: 't2', shipper_name: 'A', shipper_address: null, consignee_name: 'B', consignee_address: '' }],
      indexClients([])
    );
    expect(candidates).toEqual([]);
  });
});

describe('dedupeCandidates', () => {
  it('collapses the same address arriving from a client and a trip', () => {
    const assessed = assessCandidates([
      ...candidatesFromClients(CLIENTS),
      ...candidatesFromTrips([{
        id: 't1',
        consignee_name: 'Depozit Sud',
        consignee_address: 'Bucuresti, Sos. Olteniței nr. 200',
      }], indexClients(CLIENTS)),
    ]);
    const result = dedupeCandidates(assessed);
    expect(result.rows).toHaveLength(2);
    expect(result.merged).toBe(1);
  });

  it('keeps the client record as the surviving name', () => {
    const assessed = assessCandidates([
      { source: 'trip_consignee', client_id: null, name: 'DEPOZIT SUD (poarta 2)', address: 'București, Șoseaua Olteniței 200' },
      { source: 'client', client_id: 'c2', name: 'Depozit Sud SA', address: 'București, Șoseaua Olteniței 200' },
    ]);
    const { rows } = dedupeCandidates(assessed);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Depozit Sud SA');
    expect(rows[0].client_id).toBe('c2');
    expect(rows[0].sources).toEqual(['trip_consignee', 'client']);
  });

  it('backfills a missing client_id from a duplicate that has one', () => {
    const assessed = assessCandidates([
      { source: 'trip_shipper', client_id: null, name: 'A', address: 'Cluj-Napoca, str. Fabricii 12' },
      { source: 'trip_consignee', client_id: 'c1', name: 'A', address: 'Cluj-Napoca, Strada Fabricii nr. 12' },
    ]);
    const { rows } = dedupeCandidates(assessed);
    expect(rows[0].client_id).toBe('c1');
  });

  it('skips addresses already present in locations, so re-running is a no-op', () => {
    const assessed = assessCandidates(candidatesFromClients(CLIENTS));
    const existingKeys = new Set(assessed.map((c) => c.address_key));
    const result = dedupeCandidates(assessed, { existingKeys });
    expect(result.rows).toEqual([]);
    expect(result.skippedExisting).toBe(2);
  });

  it('counts addresses that produce no key as unusable rather than inserting junk', () => {
    const assessed = assessCandidates([{ source: 'client', name: 'X', address: '' }]);
    const result = dedupeCandidates(assessed);
    expect(result.rows).toEqual([]);
    expect(result.unusable).toBe(1);
  });
});

describe('toLocationRow', () => {
  it('maps onto the locations columns and leaves coordinates unset', () => {
    const [candidate] = assessCandidates(candidatesFromClients([CLIENTS[0]]));
    const row = toLocationRow(candidate, 'company-1');
    expect(row).toMatchObject({
      company_id: 'company-1',
      client_id: 'c1',
      name: 'SC Logistics Nord SRL',
      kind: 'client',
      city: 'cluj napoca',
      county: 'CJ',
      country: 'RO',
      geocode_source: 'import',
      geocode_verified: false,
    });
    expect(row).not.toHaveProperty('latitude');
    expect(row.address_key).toBe('cj|cluj napoca|strada fabricii 12');
  });

  it('truncates absurdly long names to fit the column', () => {
    const [candidate] = assessCandidates([
      { source: 'client', name: 'x'.repeat(500), address: 'Cluj-Napoca, str. A 1' },
    ]);
    expect(toLocationRow(candidate, 'co').name).toHaveLength(200);
  });
});

describe('summarize', () => {
  it('reports tier, flag and county breakdowns', () => {
    const assessed = assessCandidates([
      { source: 'client', name: 'A', address: 'Cluj-Napoca, str. Fabricii 12' },
      { source: 'client', name: 'B', address: 'Sat Cornu, com. Brebu, jud. Prahova' },
      { source: 'trip_shipper', name: 'C', address: 'Galați, Zona Industrială Est' },
    ]);
    const dedupe = dedupeCandidates(assessed);
    const report = summarize(assessed, dedupe);

    expect(report.candidates).toBe(3);
    expect(report.unique).toBe(3);
    // One of each tier: complete urban / street-centroid only / rural with no street at all
    expect(report.byTier).toEqual({ good: 1, review: 1, poor: 1 });
    expect(report.byFlag.rural).toBe(1);
    expect(report.byFlag.fara_numar).toBe(2);
    expect(report.bySource).toEqual({ client: 2, trip_shipper: 1 });
    expect(report.byCounty).toMatchObject({ CJ: 1, PH: 1, GL: 1 });
    expect(report.averageScore).toBeGreaterThan(0);
    expect(report.averageScore).toBeLessThanOrEqual(1);
  });

  it('handles an empty input without dividing by zero', () => {
    expect(summarize([])).toMatchObject({ candidates: 0, averageScore: 0 });
  });
});
