import { describe, expect, it } from 'vitest';
import { BUCHAREST_ZONE_REFERENCE, zoneReferenceFor } from './bucharestZones.js';

describe('zoneReferenceFor', () => {
  it('matches a zone code regardless of case and padding', () => {
    expect(zoneReferenceFor('ZA').label).toBe('Zona A');
    expect(zoneReferenceFor(' zb ').label).toBe('Zona B');
  });

  it('returns nothing for a code it does not know', () => {
    // Guiding a trace along the wrong ring is worse than offering no guidance at all, so an
    // unknown code gets silence rather than a best guess.
    expect(zoneReferenceFor('IF')).toBeNull();
    expect(zoneReferenceFor('')).toBeNull();
    expect(zoneReferenceFor(null)).toBeNull();
  });
});

describe('the reference itself', () => {
  it('lists each perimeter artery once, in enough detail to trace', () => {
    // A repeated street means the list was transcribed with a wrap-around duplicate, which
    // would send whoever follows it back along an edge they already traced.
    for (const [code, zone] of Object.entries(BUCHAREST_ZONE_REFERENCE)) {
      expect(zone.perimeter.length, code).toBeGreaterThan(3);
      expect(new Set(zone.perimeter).size, `${code} repeats a street`).toBe(zone.perimeter.length);
    }
  });

  it('states the tonnage threshold each zone is about', () => {
    expect(BUCHAREST_ZONE_REFERENCE.ZA.threshold).toMatch(/5,0 t/);
    expect(BUCHAREST_ZONE_REFERENCE.ZB.threshold).toMatch(/7,5 t/);
  });
});
