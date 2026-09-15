import { describe, expect, it } from 'vitest';
import {
  effectiveZone, hasStreetIndex, loadStreetIndex, lookupAddress, lookupStreet,
  resolveAddress, suggestStreets, zoneForNumber,
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

describe('house numbers', () => {
  const resolve = (query) => resolveAddress(index, lookupAddress(index, query), cityZones);

  it('lets the number decide on a street the boundary runs through', () => {
    // Calea 13 Septembrie is named in both official perimeters. 102 is inside Zone A; 250 is
    // far enough out to be Zone B. The street alone cannot say either.
    expect(resolve('Calea 13 Septembrie 102')).toMatchObject({ zone: 'ZA', source: 'number' });
    expect(resolve('Calea 13 Septembrie 250')).toMatchObject({ zone: 'ZB', source: 'number' });
  });

  it('reads the two sides of a street separately', () => {
    // Prelungirea Ferentari has the boundary along it: odd side in Zone B, even side outside.
    // Grouping the numbers without parity would answer one of them wrongly.
    expect(resolve('Prelungirea Ferentari 21')).toMatchObject({ zone: 'ZB', certain: true });
    expect(resolve('Prelungirea Ferentari 22')).toMatchObject({ zone: null, certain: true });
  });

  it('does not ask for a number it does not need', () => {
    // Calea Victoriei lies wholly inside Zone A. Demanding a house number there is busywork.
    const res = resolve('Calea Victoriei');
    expect(res).toMatchObject({ zone: 'ZA', certain: true, source: 'street' });
    expect(res.needsNumber).toBeUndefined();
  });

  it('asks for one where it would settle the answer', () => {
    expect(resolve('Șoseaua Colentina')).toMatchObject({ needsNumber: true, certain: false });
  });

  it('says it has no data rather than guessing past the last known number', () => {
    // Answering 9999 from the nearest range would invent a building.
    expect(resolve('Șoseaua Colentina 9999')).toMatchObject({ numberUnknown: true, certain: false });
  });

  it('fills a gap only when both neighbours agree', () => {
    const sides = index.numbers.get('soseaua colentina');
    const gap = sides.odd[0][1] + 2;
    const res = zoneForNumber(index, 'soseaua colentina', gap);
    // Either a confident interpolation or an explicit "between two different answers", never
    // a quiet pick of one side.
    if (res && !res.certain) expect(res.between).toHaveLength(2);
    else if (res) expect(res.zone === null || typeof res.zone === 'string').toBe(true);
  });

  it('has nothing for a street the index carries no numbers for', () => {
    expect(zoneForNumber(index, 'calea victoriei', 12)).toBeNull();
    expect(zoneForNumber(index, 'strada inexistenta', 1)).toBeNull();
    expect(zoneForNumber(index, 'soseaua colentina', 'bis')).toBeNull();
  });
});

describe('telling a street name from a street plus number', () => {
  it('keeps a number that is part of the name', () => {
    // "Bulevardul 1 Decembrie 1918" is a street. Splitting 1918 off looks up one that does not
    // exist, which is why the whole string is tried against the index first.
    const res = lookupAddress(index, 'Bulevardul 1 Decembrie 1918');
    expect(res.number).toBeNull();
    expect(res.found?.label).toMatch(/1 Decembrie 1918/);
  });

  it('splits a trailing house number off', () => {
    const res = lookupAddress(index, 'Calea Victoriei 12');
    expect(res.number).toBe('12');
    expect(res.found.key).toBe('calea victoriei');
  });

  it('does not let the fuzzy pass swallow the number', () => {
    // "Bd. Dacia 5" matched Bulevardul Dacia through the suggestion pass, which drops
    // single characters, and the 5 is the part that decides the answer.
    const res = lookupAddress(index, 'Bd. Dacia 5');
    expect(res.number).toBe('5');
    expect(resolveAddress(index, res, cityZones).source).toBe('number');
  });

  it('accepts the ways a number gets written', () => {
    for (const form of ['Calea Victoriei 12', 'Calea Victoriei nr. 12', 'Calea Victoriei, 12']) {
      expect(lookupAddress(index, form).number, form).toBe('12');
    }
  });
});
