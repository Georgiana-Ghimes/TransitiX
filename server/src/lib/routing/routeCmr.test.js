import { describe, expect, it } from 'vitest';
import { buildTripDrafts, cmrEligibleStops, fullAddress, nextCmrNumber } from './routeCmr.js';

const COMPANY = {
  name: 'Transitix Logistic SRL',
  address: 'Cluj-Napoca, str. Fabricii 12',
  cui: 'RO12345678',
  phone: '0264 000 000',
  email: 'office@transitix.ro',
};

const ROUTE = {
  id: 'route-1',
  code: 'R-01',
  route_date: '2026-08-27',
  starts_at: '08:00',
  driver_id: 'drv-1',
  vehicle_id: 'veh-1',
  driver_name: 'Ion Popescu',
  vehicle_plate: 'CJ 01 TRX',
};

const DELIVERY_STOP = {
  id: 'stop-1',
  seq: 2,
  kind: 'livrare',
  order_id: 'ord-1',
  order_number: 'CMD-20260827-01',
  location_name: 'Magazin Centru',
  address: 'Timișoara, Calea Aradului 50',
  client_name: 'Alfa SRL',
  client_cui: 'RO999',
  client_phone: '0722 000 000',
  client_email: 'alfa@example.ro',
  contact_person: 'Maria',
  phone: '0733 111 111',
  goods_description: 'Paleți cu ambalaje',
  weight_kg: 1200,
  volume_mc: 8.5,
  pallets: 6,
  planned_arrival: '2026-08-27T10:30:00.000Z',
};

describe('nextCmrNumber', () => {
  it('starts a day at 01', () => {
    expect(nextCmrNumber('2026-08-27', [])).toBe('CMR-2026-0827-01');
  });

  it('continues after the highest number of that day', () => {
    const existing = ['CMR-2026-0827-01', 'CMR-2026-0827-07', 'CMR-2026-0826-99'];
    expect(nextCmrNumber('2026-08-27', existing)).toBe('CMR-2026-0827-08');
  });

  it('ignores numbers that are not ours', () => {
    expect(nextCmrNumber('2026-08-27', ['CMR-2026-0827-abc', 'AWB-1'])).toBe('CMR-2026-0827-01');
  });

  it('offsets so a batch does not collide with itself', () => {
    expect(nextCmrNumber('2026-08-27', ['CMR-2026-0827-01'], 2)).toBe('CMR-2026-0827-04');
  });

  it('refuses a date it cannot read', () => {
    expect(nextCmrNumber('', [])).toBeNull();
    expect(nextCmrNumber('27.08.2026', [])).toBeNull();
  });
});

describe('fullAddress', () => {
  it('puts the street back together with its town', () => {
    expect(fullAddress({ address: 'str. Republicii 1', city: 'oradea', county: 'BH' }))
      .toBe('str. Republicii 1, Oradea, BH');
  });

  it('does not repeat a town the street already names', () => {
    expect(fullAddress({ address: 'Cluj-Napoca, str. Fabricii 12', city: 'cluj napoca' }))
      .toBe('Cluj-Napoca, str. Fabricii 12');
  });

  it('leaves a properly cased town alone', () => {
    expect(fullAddress({ address: 'Calea Aradului 50', city: 'Timișoara', county: 'TM' }))
      .toBe('Calea Aradului 50, Timișoara, TM');
  });

  it('returns null when there is nothing to compose', () => {
    expect(fullAddress({})).toBeNull();
  });
});

describe('cmrEligibleStops', () => {
  it('keeps only stops that carry an order', () => {
    const stops = [
      { id: 'a', kind: 'depot_start' },
      { id: 'b', kind: 'livrare', order_id: 'o1' },
      { id: 'c', kind: 'pauza' },
      { id: 'd', kind: 'ridicare', order_id: 'o2' },
      { id: 'e', kind: 'livrare' },
      { id: 'f', kind: 'depot_end' },
    ];
    expect(cmrEligibleStops(stops).map((s) => s.id)).toEqual(['b', 'd']);
  });
});

describe('buildTripDrafts', () => {
  it('makes the company the shipper on a delivery', () => {
    const [draft] = buildTripDrafts({ route: ROUTE, stops: [DELIVERY_STOP], company: COMPANY });
    expect(draft.shipper_name).toBe('Transitix Logistic SRL');
    expect(draft.shipper_cui).toBe('RO12345678');
    expect(draft.consignee_name).toBe('Magazin Centru');
    expect(draft.consignee_address).toBe('Timișoara, Calea Aradului 50');
    expect(draft.consignee_cui).toBe('RO999');
  });

  it('turns the document around on a pickup', () => {
    const [draft] = buildTripDrafts({
      route: ROUTE,
      stops: [{ ...DELIVERY_STOP, kind: 'ridicare' }],
      company: COMPANY,
    });
    expect(draft.shipper_name).toBe('Magazin Centru');
    expect(draft.consignee_name).toBe('Transitix Logistic SRL');
  });

  it('carries the plan onto the document', () => {
    const [draft] = buildTripDrafts({ route: ROUTE, stops: [DELIVERY_STOP], company: COMPANY });
    expect(draft).toMatchObject({
      route_id: 'route-1',
      route_stop_id: 'stop-1',
      driver_name: 'Ion Popescu',
      vehicle_plate: 'CJ 01 TRX',
      loading_date: '2026-08-27',
      loading_time: '08:00',
      weight_kg: 1200,
      volume_mc: 8.5,
      package_count: 6,
      status: 'alocata',
    });
    expect(draft.internal_notes).toContain('R-01');
    expect(draft.internal_notes).toContain('CMD-20260827-01');
  });

  it('leaves a route with no driver as a plan, not an allocation', () => {
    const [draft] = buildTripDrafts({
      route: { ...ROUTE, driver_id: null, driver_name: null },
      stops: [DELIVERY_STOP],
      company: COMPANY,
    });
    expect(draft.status).toBe('planificata');
    expect(draft.driver_id).toBeNull();
  });

  it('numbers a batch without colliding with itself', () => {
    const drafts = buildTripDrafts({
      route: ROUTE,
      stops: [
        DELIVERY_STOP,
        { ...DELIVERY_STOP, id: 'stop-2', seq: 3, order_id: 'ord-2' },
        { ...DELIVERY_STOP, id: 'stop-3', seq: 4, order_id: 'ord-3' },
      ],
      company: COMPANY,
      existingNumbers: ['CMR-2026-0827-01'],
    });
    expect(drafts.map((d) => d.cmr_number)).toEqual([
      'CMR-2026-0827-02', 'CMR-2026-0827-03', 'CMR-2026-0827-04',
    ]);
  });

  it('skips stops that already produced a document', () => {
    const drafts = buildTripDrafts({
      route: ROUTE,
      stops: [DELIVERY_STOP, { ...DELIVERY_STOP, id: 'stop-2', order_id: 'ord-2' }],
      company: COMPANY,
      skipStopIds: ['stop-1'],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].route_stop_id).toBe('stop-2');
  });

  it('falls back to the route date when a stop has no ETA', () => {
    const [draft] = buildTripDrafts({
      route: ROUTE,
      stops: [{ ...DELIVERY_STOP, planned_arrival: null }],
      company: COMPANY,
    });
    expect(draft.estimated_delivery_date).toBe('2026-08-27');
    expect(draft.estimated_delivery_time).toBeNull();
  });

  it('does not invent quantities that were never set', () => {
    const [draft] = buildTripDrafts({
      route: ROUTE,
      stops: [{ ...DELIVERY_STOP, weight_kg: null, volume_mc: null, pallets: null }],
      company: COMPANY,
    });
    expect(draft.weight_kg).toBeNull();
    expect(draft.volume_mc).toBeNull();
    expect(draft.package_count).toBeNull();
  });

  it('returns nothing without a route', () => {
    expect(buildTripDrafts({ stops: [DELIVERY_STOP] })).toEqual([]);
  });
});
