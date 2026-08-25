import { describe, expect, it } from 'vitest';
import {
  addressKey,
  assessAddress,
  extractHouseNumber,
  parseRomanianAddress,
  streetNameTokens,
  stripDiacritics,
} from './address.js';

describe('stripDiacritics', () => {
  it('folds every Romanian diacritic, both cedilla and comma variants', () => {
    expect(stripDiacritics('Brașov Timișoara Constanța')).toBe('Brasov Timisoara Constanta');
    expect(stripDiacritics('Brasov')).toBe('Brasov');
    // U+015F/U+0163 (cedilla) still appear in older Romanian data next to U+0219/U+021B
    expect(stripDiacritics('Timişoara Galaţi')).toBe('Timisoara Galati');
    expect(stripDiacritics('Târgu Mureș Câmpina Iași')).toBe('Targu Mures Campina Iasi');
  });
});

describe('parseRomanianAddress', () => {
  it('splits the seed format "Oraș, str. Stradă Nr"', () => {
    const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii de Zahăr 9');
    expect(parsed.city).toBe('cluj napoca');
    expect(parsed.county).toBe('CJ');
    expect(parsed.street).toBe('str. Fabricii de Zahăr 9');
    expect(parsed.cityKnown).toBe(true);
    expect(parsed.hasStreetType).toBe(true);
    expect(parsed.hasHouseNumber).toBe(true);
  });

  it('resolves the county from the city for every seed address shape', () => {
    const cases = [
      ['București, Șos. Pipera 1', 'bucuresti', 'B'],
      ['Constanța, B-dul Mamaia 120', 'constanta', 'CT'],
      ['Timișoara, Calea Torontalului 88', 'timisoara', 'TM'],
      ['Iași, Șoseaua Națională 210', 'iasi', 'IS'],
      ['Ploiești, str. Industriilor 5', 'ploiesti', 'PH'],
    ];
    for (const [raw, city, county] of cases) {
      const parsed = parseRomanianAddress(raw);
      expect([raw, parsed.city, parsed.county]).toEqual([raw, city, county]);
    }
  });

  it('prefers the longest matching city name', () => {
    expect(parseRomanianAddress('Târgu Mureș, str. Gheorghe Doja 4').city).toBe('targu mures');
    expect(parseRomanianAddress('Baia Mare, str. Victoriei 2').county).toBe('MM');
  });

  it('reads an explicit county even when the locality is unknown', () => {
    const parsed = parseRomanianAddress('Sat Cornu, com. Brebu, jud. Prahova');
    expect(parsed.county).toBe('PH');
    expect(parsed.isRural).toBe(true);
    expect(parsed.hasStreetType).toBe(false);
    expect(parsed.hasHouseNumber).toBe(false);
  });

  it('handles an address with no street type at all', () => {
    const parsed = parseRomanianAddress('Galați, Zona Industrială Est');
    expect(parsed.city).toBe('galati');
    // "zona" counts as a street type — otherwise industrial-park addresses score as junk
    expect(parsed.hasStreetType).toBe(true);
    expect(parsed.hasHouseNumber).toBe(false);
  });

  it('splits city from street when no comma separates them', () => {
    const parsed = parseRomanianAddress('Timisoara Calea Aradului 50');
    expect(parsed.city).toBe('timisoara');
    expect(parsed.county).toBe('TM');
    expect(parsed.street).toBe('calea aradului 50');
    expect(parsed.hasHouseNumber).toBe(true);
  });

  it('does not mistake a city name inside a street for the locality', () => {
    // "Calea Bucureștilor" is a street in Otopeni, not the city of București.
    const parsed = parseRomanianAddress('Otopeni, Calea Bucureștilor 224E');
    expect(parsed.city).toBe('otopeni');
    expect(parsed.county).toBe('IF');
    expect(parsed.hasHouseNumber).toBe(true);
  });

  it('reads a bare plate code as the county, not as street text', () => {
    // The backfill recombines address + city + county, so "…, bucuresti, B" is the normal
    // input shape. Treating "B" as street text corrupted the address_key.
    const parsed = parseRomanianAddress('Șoseaua Olteniței 200, bucuresti, B');
    expect(parsed.county).toBe('B');
    expect(parsed.street).toBe('Șoseaua Olteniței 200');
    expect(addressKey(parsed)).toBe('b|bucuresti|soseaua oltenitei 200');
  });

  it('reads a plate code after jud.', () => {
    expect(parseRomanianAddress('str. Fabricii 12, Cluj-Napoca, jud. CJ').county).toBe('CJ');
  });

  it('keys the same address identically whether it carries the code or not', () => {
    expect(addressKey('Calea Aradului 50, timisoara, TM'))
      .toBe(addressKey('Timișoara, Calea Aradului 50'));
  });

  it('strips the municipiul/orașul prefix', () => {
    expect(parseRomanianAddress('Mun. Brașov, str. Muncii 44').city).toBe('brasov');
    expect(parseRomanianAddress('Oraș Otopeni, Calea Bucureștilor 3').county).toBe('IF');
  });

  it('picks up a six-digit postcode', () => {
    expect(parseRomanianAddress('București, Str. Aviatorilor 10, 011853').postcode).toBe('011853');
    expect(parseRomanianAddress('București, Str. Aviatorilor 10').postcode).toBe(null);
  });

  it('returns empty parts for blank input instead of throwing', () => {
    const parsed = parseRomanianAddress('   ');
    expect(parsed.raw).toBe('');
    expect(parsed.city).toBe(null);
    expect(parsed.street).toBe(null);
  });
});

describe('addressKey', () => {
  it('collapses spellings of the same address', () => {
    const keys = [
      'Cluj-Napoca, str. Fabricii 12',
      'Cluj-Napoca, Strada Fabricii nr. 12',
      'CLUJ-NAPOCA, STR. FABRICII 12',
      'Cluj-Napoca,  str.  Fabricii  12 ',
    ].map((a) => addressKey(a));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('cj|cluj napoca|strada fabricii 12');
  });

  it('collapses a hyphenated city with its spaced spelling', () => {
    // Real imports carry both "Cluj-Napoca" and "CLUJ NAPOCA"; before the hyphen was
    // normalized these produced two locations for one address.
    expect(addressKey('Cluj-Napoca, str. Fabricii 12'))
      .toBe(addressKey('CLUJ NAPOCA, Strada Fabricii nr. 12'));
  });

  it('collapses an address with no comma between city and street', () => {
    // "Timisoara Calea Aradului 50" used to lose its city and county entirely.
    expect(addressKey('Timisoara Calea Aradului 50'))
      .toBe(addressKey('Timișoara, Calea Aradului 50'));
  });

  it('folds diacritics so both spellings of a city collapse', () => {
    expect(addressKey('Timișoara, Calea Aradului 50'))
      .toBe(addressKey('Timisoara, Calea Aradului 50'));
  });

  it('keeps different house numbers apart', () => {
    expect(addressKey('Cluj-Napoca, str. Fabricii 12'))
      .not.toBe(addressKey('Cluj-Napoca, str. Fabricii 14'));
  });

  it('keeps the same street in different cities apart', () => {
    expect(addressKey('Cluj-Napoca, str. Unirii 1'))
      .not.toBe(addressKey('Iași, str. Unirii 1'));
  });

  it('falls back to the whole normalized string when nothing parses', () => {
    expect(addressKey('la km 7 pe centura')).toBeTruthy();
  });

  it('returns null for an empty address', () => {
    expect(addressKey('')).toBe(null);
  });
});

describe('assessAddress', () => {
  it('scores a complete urban address as good', () => {
    const result = assessAddress('Cluj-Napoca, str. Fabricii de Zahăr 9');
    expect(result.score).toBe(1);
    expect(result.tier).toBe('good');
    expect(result.flags).toEqual([]);
  });

  it('caps a rural address even when every part is present', () => {
    const result = assessAddress('Sat Cornu, com. Brebu, jud. Prahova');
    expect(result.tier).not.toBe('good');
    expect(result.score).toBeLessThanOrEqual(0.6);
    expect(result.flags).toContain('rural');
  });

  it('flags exactly what is missing', () => {
    const result = assessAddress('Galați, Zona Industrială Est');
    expect(result.flags).toContain('fara_numar');
    expect(result.flags).not.toContain('fara_oras');
    expect(result.flags).not.toContain('fara_judet');
  });

  it('never calls an address good without a house number', () => {
    // Known city and county, but no number: a geocoder can only reach the street centroid,
    // so this must land in the review queue rather than pass as a delivery point.
    const result = assessAddress('Galați, Zona Industrială Est');
    expect(result.score).toBe(0.75);
    expect(result.tier).toBe('review');
  });

  it('flags an unrecognised city without discarding it', () => {
    const result = assessAddress('Vadu Crișului, str. Principală 3');
    expect(result.flags).toContain('oras_nerecunoscut');
    expect(result.parsed.city).toBe('vadu crisului');
  });

  it('scores a blank address as poor rather than crashing', () => {
    expect(assessAddress('')).toMatchObject({ score: 0, tier: 'poor', flags: ['fara_adresa'] });
  });
});

describe('streetNameTokens', () => {
  it('drops the street type so only the name identifies the street', () => {
    expect(streetNameTokens('Calea Aradului 50')).toEqual(['aradului']);
    expect(streetNameTokens('str. Fabricii de Zahar 9')).toEqual(['fabricii', 'de', 'zahar']);
  });

  it('leaves two streets sharing a type word with nothing in common', () => {
    const a = streetNameTokens('Calea Aradului');
    const b = streetNameTokens('Calea Torontalului');
    expect(a.filter((t) => b.includes(t))).toEqual([]);
  });

  it('drops block and flat details', () => {
    expect(streetNameTokens('Bd. Unirii 1, bl. A2, ap. 45')).toEqual(['unirii']);
  });
});

describe('extractHouseNumber', () => {
  it('takes the number after an explicit nr', () => {
    expect(extractHouseNumber('Strada 1 Decembrie 1918 nr. 5')).toBe('5');
  });

  it('takes the trailing number when there is no nr', () => {
    expect(extractHouseNumber('Calea Aradului 50')).toBe('50');
    expect(extractHouseNumber('Calea Bucurestilor 224E')).toBe('224e');
  });

  it('ignores block, stair and flat numbers', () => {
    expect(extractHouseNumber('Bd. Unirii 1, bl. A2, sc. 3, ap. 45')).toBe('1');
  });

  it('returns null when there is no number', () => {
    expect(extractHouseNumber('Zona Industriala Est')).toBe(null);
    expect(extractHouseNumber('')).toBe(null);
  });
});
