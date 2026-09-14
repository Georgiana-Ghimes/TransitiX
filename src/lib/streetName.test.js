import { describe, expect, it } from 'vitest';
import { normalizeStreetName, plainText, streetNameWithoutType } from './streetName.js';

describe('plainText', () => {
  it('folds diacritics, including the cedilla forms OSM still carries', () => {
    expect(plainText('Șoseaua Ștefan')).toBe(plainText('Soseaua Stefan'));
    expect(plainText('Şoseaua')).toBe('soseaua');
    expect(plainText('Piaţa')).toBe('piata');
  });
});

describe('normalizeStreetName', () => {
  it('reaches one key from every spelling of the type word', () => {
    const forms = ['Bulevardul Dacia', 'B-dul Dacia', 'bd. Dacia', 'bd Dacia', 'BD DACIA', 'Bdul Dacia'];
    for (const form of forms) expect(normalizeStreetName(form), form).toBe('bulevardul dacia');
  });

  it('handles the other Romanian street types', () => {
    expect(normalizeStreetName('sos. Colentina')).toBe('soseaua colentina');
    expect(normalizeStreetName('Str. Traian')).toBe('strada traian');
    expect(normalizeStreetName('Pta Unirii')).toBe('piata unirii');
    expect(normalizeStreetName('Spl. Unirii')).toBe('splaiul unirii');
    expect(normalizeStreetName('Prel. Ferentari')).toBe('prelungirea ferentari');
  });

  it('keeps the type word rather than dropping it', () => {
    // "Strada Nicolae Iorga" and "Calea Nicolae Iorga" would be different streets. Collapsing
    // them would hand one street's zone — and its tariff — to the other.
    expect(normalizeStreetName('Strada Nicolae Iorga'))
      .not.toBe(normalizeStreetName('Calea Nicolae Iorga'));
  });

  it('leaves a bare name alone instead of inventing a type', () => {
    // Inventing "strada" would stop it matching the row the index actually built.
    expect(normalizeStreetName('Dacia')).toBe('dacia');
    expect(normalizeStreetName('Unirii')).toBe('unirii');
  });

  it('does not eat a name that merely starts like a type word', () => {
    expect(normalizeStreetName('Drumul Sării')).toBe('drumul sarii');
    expect(normalizeStreetName('Calea')).toBe('calea');
  });

  it('survives punctuation and stray spacing', () => {
    expect(normalizeStreetName('  B-dul   Dacia  ')).toBe('bulevardul dacia');
    expect(normalizeStreetName('')).toBe('');
    expect(normalizeStreetName(null)).toBe('');
  });
});

describe('streetNameWithoutType', () => {
  it('strips a recognised type word', () => {
    expect(streetNameWithoutType('B-dul Dacia')).toBe('dacia');
    expect(streetNameWithoutType('Dacia')).toBe('dacia');
  });

  it('leaves a single-word name whole', () => {
    expect(streetNameWithoutType('Calea')).toBe('calea');
  });
});
