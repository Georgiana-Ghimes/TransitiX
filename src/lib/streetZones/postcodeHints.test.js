import { describe, expect, it } from 'vitest';
import {
  BUCURESTI_POSTCODE_STREETS,
  cityIdFromRoPostcode,
  streetKeyFromPostcode,
} from './postcodeHints.js';

describe('cityIdFromRoPostcode', () => {
  it('maps București sector ranges 01–06', () => {
    expect(cityIdFromRoPostcode('050151')).toBe('bucuresti');
    expect(cityIdFromRoPostcode('RO 013596')).toBeNull(); // not normalised here
    expect(cityIdFromRoPostcode('061129')).toBe('bucuresti');
  });

  it('leaves Ilfov / other counties alone', () => {
    expect(cityIdFromRoPostcode('077190')).toBeNull();
    expect(cityIdFromRoPostcode('087015')).toBeNull();
  });
});

describe('streetKeyFromPostcode', () => {
  it('knows Șos. Viilor via 050151', () => {
    expect(streetKeyFromPostcode('050151')).toBe('soseaua viilor');
    expect(BUCURESTI_POSTCODE_STREETS['050151']).toBe('soseaua viilor');
  });

  it('returns null for an unmapped code', () => {
    expect(streetKeyFromPostcode('999999')).toBeNull();
  });
});
