import { describe, expect, it } from 'vitest';
import {
  effectiveZone, hasStreetIndex, loadStreetIndex, lookupStreet, suggestStreets,
} from './index.js';
import { ZONE_CITIES } from '../zoneReference.js';

const cityZones = ZONE_CITIES[0].zones;
const index = await loadStreetIndex('bucuresti');

describe('loading', () => {
  it('knows which cities have an index', () => {
    expect(hasStreetIndex('bucuresti')).toBe(true);
    expect(hasStreetIndex('cluj')).toBe(false);
  });

  it('returns nothing for a city without one, rather than throwing', async () => {
    expect(await loadStreetIndex('cluj')).toBeNull();
  });

  it('loads once and hands back the same object', async () => {
    expect(await loadStreetIndex('bucuresti')).toBe(index);
  });

  it('covers the whole city, not only the restricted part', () => {
    // Streets outside every zone are kept on purpose: "this street is unrestricted" is a real
    // answer, and it has to be distinguishable from "no such street".
    expect(index.all.length).toBeGreaterThan(5000);
    expect(index.all.some((e) => e.zones.length === 0)).toBe(true);
  });
});

describe('lookupStreet', () => {
  it('finds a central street and reports it whole', () => {
    const res = lookupStreet(index, 'Calea Victoriei');
    expect(res.status).toBe('exact');
    expect(res.found.zones.map((z) => z.code)).toContain('ZA');
    expect(res.found.zones.every((z) => z.whole)).toBe(true);
  });

  it('finds the same street however the type word is written', () => {
    for (const form of ['bd. Dacia', 'B-dul Dacia', 'Bulevardul Dacia']) {
      expect(lookupStreet(index, form).found?.key, form).toBe('bulevardul dacia');
    }
  });

  it('refuses to guess between two streets with the same bare name', () => {
    // Strada Dacia is outside every zone; Bulevardul Dacia runs into Zone A. Picking one
    // silently is a coin flip between nothing and up to 3.534 lei a day.
    const res = lookupStreet(index, 'Dacia');
    expect(res.status).toBe('ambiguous');
    expect(res.found).toBeNull();
    expect(res.suggestions.map((s) => s.label).sort())
      .toEqual(['Bulevardul Dacia', 'Strada Dacia']);
  });

  it('confirms the two Dacias really do disagree', () => {
    const strada = lookupStreet(index, 'Strada Dacia').found;
    const bulevard = lookupStreet(index, 'Bulevardul Dacia').found;
    expect(effectiveZone(strada, cityZones)).toBeNull();
    expect(effectiveZone(bulevard, cityZones).code).toBe('ZA');
  });

  it('matches without the type word when only one street can be meant', () => {
    const only = index.all.find((e) => (index.byBareName.get(
      e.key.split(' ').slice(1).join(' '),
    ) ?? []).length === 1 && e.key.includes(' '));
    const bare = only.key.split(' ').slice(1).join(' ');
    const res = lookupStreet(index, bare);
    expect(res.status).toBe('without-type');
    expect(res.found.key).toBe(only.key);
  });

  it('separates an unknown street from an unrestricted one', () => {
    // These must never collapse: one is a spelling we lack, the other is a real answer.
    const unknown = lookupStreet(index, 'Strada Care Nu Exista Nicaieri');
    expect(unknown.status).toBe('unknown');
    expect(unknown.found).toBeNull();

    const outside = index.all.find((e) => e.zones.length === 0);
    expect(lookupStreet(index, outside.label).found).toBeTruthy();
  });

  it('offers suggestions when nothing matched', () => {
    const res = lookupStreet(index, 'Victorie');
    expect(res.suggestions.length).toBeGreaterThan(0);
  });

  it('is empty-safe', () => {
    expect(lookupStreet(index, '').status).toBe('unknown');
    expect(lookupStreet(null, 'Calea Victoriei').status).toBe('unknown');
  });
});

describe('several streets, one name', () => {
  it('asks only when the candidates actually disagree', () => {
    const res = lookupStreet(index, 'Dacia');
    expect(res.status).toBe('ambiguous');
    expect(res.suggestions.length).toBeGreaterThan(1);
  });

  it('answers straight when they all give the same zone', () => {
    // Intrarea, Piața and Strada Baba Novac are three streets and one answer. Making somebody
    // choose between identical outcomes teaches them to click past the prompt that matters.
    const res = lookupStreet(index, 'Baba Novac');
    expect(res.status).toBe('without-type');
    expect(res.sharedWith).toBeGreaterThan(1);
    expect(effectiveZone(res.found, cityZones).code).toBe('ZB');
  });
});

describe('short forms people actually type', () => {
  it('finds a boulevard by the name it is known by', () => {
    // OSM carries "Bulevardul General Gheorghe Magheru"; nobody types that. Substring matching
    // returned nothing at all here, not even a suggestion.
    const res = lookupStreet(index, 'bd. Magheru');
    expect(res.found?.label).toMatch(/Magheru/);
    expect(effectiveZone(res.found, cityZones).code).toBe('ZA');
  });

  it('matches words in any order', () => {
    // There is a Strada and a Bulevardul General Gheorghe Magheru and they sit in different
    // zones, so the right answer here is the question, not a pick.
    const res = lookupStreet(index, 'Magheru Gheorghe');
    expect(res.status).toBe('ambiguous');
    expect(res.suggestions.every((e) => e.key.includes('magheru'))).toBe(true);
  });

  it('prefers the type word when it is given', () => {
    // "bd. Magheru" is not ambiguous even though "Magheru" is: the type word rules out the
    // Strada, which is the whole reason normalizeStreetName keeps it.
    expect(lookupStreet(index, 'Magheru').status).toBe('ambiguous');
    expect(lookupStreet(index, 'bd. Magheru').status).toBe('without-type');
  });
});

describe('suggestStreets', () => {
  it('offers every street matching a fragment, in a stable order', () => {
    const names = suggestStreets(index, 'Dacia', 5).map((e) => e.key);
    expect(names).toContain('strada dacia');
    expect(names).toContain('bulevardul dacia');
    expect(suggestStreets(index, 'Dacia', 5).map((e) => e.key)).toEqual(names);
  });

  it('ranks the tightest fit first', () => {
    // "Strada Dacia" is all query and nothing else; the longer names come after.
    expect(suggestStreets(index, 'Dacia', 3)[0].key).toMatch(/dacia$/);
  });

  it('stays quiet until there is enough to go on', () => {
    expect(suggestStreets(index, 'a')).toEqual([]);
  });
});

describe('effectiveZone', () => {
  it('answers with the strictest zone that applies', () => {
    // Zone A sits inside Zone B, so a central street is in both. A is the one to act on.
    const res = effectiveZone(lookupStreet(index, 'Calea Victoriei').found, cityZones);
    expect(res.code).toBe('ZA');
    expect(res.certain).toBe(true);
  });

  it('flags a street that only partly lies in its zone', () => {
    // Calea 13 Septembrie is named in both official perimeters, so it runs along the boundary
    // and the house number decides. Reporting it as a plain "Zone A" would be a guess.
    const res = effectiveZone(lookupStreet(index, 'Calea 13 Septembrie').found, cityZones);
    expect(res.code).toBe('ZA');
    expect(res.certain).toBe(false);
  });

  it('is null for a street in no zone', () => {
    const outside = index.all.find((e) => e.zones.length === 0);
    expect(effectiveZone(outside, cityZones)).toBeNull();
    expect(effectiveZone(null, cityZones)).toBeNull();
  });
});
