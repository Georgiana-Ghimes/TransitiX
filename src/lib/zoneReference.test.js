import { describe, expect, it } from 'vitest';
import { ZONE_CITIES, allReferenceZones, cityById, referenceZone } from './zoneReference.js';
import { geometryBounds, geometryToRings, ringMetrics } from './zoneGeometry.js';
import { findZoneRate } from '../../server/src/lib/pricing/taxes.js';

describe('the shipped reference', () => {
  it('gives every city a tab identity and a place to open', () => {
    for (const city of ZONE_CITIES) {
      expect(city.id, 'id').toBeTruthy();
      expect(city.label, city.id).toBeTruthy();
      expect(city.center, city.id).toHaveLength(2);
      expect(city.zones.length, city.id).toBeGreaterThan(0);
    }
  });

  it('keeps zone codes unique across cities', () => {
    // A code is how a reference zone finds its tax_zones row. Two cities sharing one would
    // link Cluj's outline to Bucharest's rates.
    const codes = allReferenceZones().map((z) => z.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('ships a drawable outline for every zone', () => {
    for (const zone of allReferenceZones()) {
      expect(geometryToRings(zone.outline).length, zone.code).toBeGreaterThan(0);
    }
  });
});

describe('Bucharest A and B', () => {
  const za = referenceZone('ZA');
  const zb = referenceZone('ZB');

  it('puts A inside B', () => {
    // The whole reason A carries the higher priority. If this ever stops holding, the
    // priorities below are describing a relationship that no longer exists.
    const [[as, aw], [an, ae]] = geometryBounds(za.outline);
    const [[bs, bw], [bn, be]] = geometryBounds(zb.outline);
    expect(as).toBeGreaterThan(bs);
    expect(aw).toBeGreaterThan(bw);
    expect(an).toBeLessThan(bn);
    expect(ae).toBeLessThan(be);
  });

  it('ranks A above B so the stricter zone wins where both contain a point', () => {
    expect(za.priority).toBeGreaterThan(zb.priority);
  });

  it('lands on Bucharest, not somewhere a transposed file would put it', () => {
    const [[s, w], [n, e]] = geometryBounds(zb.outline);
    expect(s).toBeGreaterThan(44.3);
    expect(n).toBeLessThan(44.6);
    expect(w).toBeGreaterThan(25.9);
    expect(e).toBeLessThan(26.3);
  });

  it('carries outlines that are shapes, not scribbles', () => {
    // Compactness near zero would mean the cleanup that produced this file left a sliver
    // where the boundary should be.
    for (const zone of [za, zb]) {
      expect(ringMetrics(zone.outline.coordinates[0]).compactness, zone.code).toBeGreaterThan(0.3);
    }
  });

  it('has no leftover zero-area rings', () => {
    for (const zone of [za, zb]) {
      expect(zone.outline.coordinates, zone.code).toHaveLength(1);
    }
  });

  it('states each tonnage threshold and the perimeter it follows', () => {
    expect(za.threshold).toMatch(/5,0 t/);
    expect(zb.threshold).toMatch(/7,5 t/);
    expect(za.perimeter.length).toBeGreaterThan(20);
    expect(zb.perimeter.length).toBeGreaterThan(30);
  });
});

describe('lookups', () => {
  it('finds a zone by code, however it is typed', () => {
    expect(referenceZone('za').name).toBe('Zona A');
    expect(referenceZone(' ZB ').name).toBe('Zona B');
  });

  it('returns nothing for a code it does not ship', () => {
    expect(referenceZone('IF')).toBeNull();
    expect(referenceZone(null)).toBeNull();
  });

  it('falls back to the first city rather than leaving the map blank', () => {
    expect(cityById('nu-exista').id).toBe(ZONE_CITIES[0].id);
    expect(cityById('bucuresti').label).toBe('București');
  });
});

describe('the shipped tariffs', () => {
  const za = referenceZone('ZA');
  const zb = referenceZone('ZB');

  const asRates = (zone) => zone.tariffs.brackets.map((b, i) => ({
    id: `${zone.code}-${i}`,
    mma_min_kg: b.minKg,
    mma_max_kg: b.maxKg,
    amount: b.daily,
    currency: zone.tariffs.currency,
    valid_from: zone.tariffs.validFrom,
    valid_to: null,
  }));

  const dayRate = (zone, kg) =>
    findZoneRate(asRates(zone), { mmaKg: kg, onDate: '2026-06-01' })?.amount ?? null;

  it('matches the published Zona A table at every bracket', () => {
    expect([7500, 12500, 16000, 22000, 40000, 44000].map((kg) => dayRate(za, kg)))
      .toEqual([363, 711, 1421, 2133, 2843, 3534]);
  });

  it('matches the published Zona B table at every bracket', () => {
    expect([7500, 12500, 16000, 22000, 40000, 44000].map((kg) => dayRate(zb, kg)))
      .toEqual([100, 183, 280, 363, 446, 547]);
  });

  it('reads an inclusive upper bound the way the decision states it', () => {
    // The brackets cannot be written as the table prints them. Sharing a boundary makes both
    // brackets match at that exact weight, and findZoneRate breaks the tie on the narrowest
    // span, which picks the HIGHER bracket. A 12,5 t truck in Zona A would have been charged
    // 1421 lei where the decision says 711.
    expect(dayRate(za, 12500)).toBe(711);
    expect(dayRate(za, 12501)).toBe(1421);
    expect(dayRate(za, 7500)).toBe(363);
    expect(dayRate(za, 7501)).toBe(711);
  });

  it('leaves a vehicle at exactly 5 t untaxed', () => {
    // The restriction is "mai mare de 5 tone", so 5000 kg needs no authorisation at all.
    expect(dayRate(za, 5000)).toBeNull();
    expect(dayRate(za, 5001)).toBe(363);
  });

  it('never leaves a gap or an overlap between brackets', () => {
    for (const zone of [za, zb]) {
      const b = zone.tariffs.brackets;
      for (let i = 1; i < b.length; i += 1) {
        expect(b[i].minKg, `${zone.code} bracket ${i}`).toBe(b[i - 1].maxKg + 1);
      }
      expect(b[b.length - 1].maxKg, `${zone.code} top bracket is open`).toBeNull();
    }
  });

  it('charges Zona A more than Zona B in every bracket', () => {
    // A is the inner, stricter zone. If this ever inverts, the numbers were transcribed
    // into the wrong zone.
    za.tariffs.brackets.forEach((a, i) => {
      expect(a.daily, `bracket ${i} daily`).toBeGreaterThan(zb.tariffs.brackets[i].daily);
      expect(a.monthly, `bracket ${i} monthly`).toBeGreaterThan(zb.tariffs.brackets[i].monthly);
    });
  });

  it('rises with weight and costs less per day on a monthly permit', () => {
    for (const zone of [za, zb]) {
      const b = zone.tariffs.brackets;
      for (let i = 1; i < b.length; i += 1) {
        expect(b[i].daily, `${zone.code} daily ${i}`).toBeGreaterThan(b[i - 1].daily);
        expect(b[i].monthly, `${zone.code} monthly ${i}`).toBeGreaterThan(b[i - 1].monthly);
      }
      for (const bracket of b) {
        expect(bracket.monthly).toBeLessThan(bracket.daily * 30);
      }
    }
  });

  it('says which decision set the figures and when they start', () => {
    for (const zone of [za, zb]) {
      expect(zone.tariffs.source).toMatch(/HCGMB/);
      expect(zone.tariffs.validFrom).toBe('2026-01-01');
      expect(zone.tariffs.currency).toBe('RON');
    }
  });
});
