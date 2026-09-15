import { describe, expect, it } from 'vitest';
import { canonicalPlateClient, mmaLabel, parseMmaKg } from './fleetUi.js';

describe('canonicalPlateClient', () => {
  it('stores one form, whatever was typed', () => {
    for (const form of ['B 112 VFM', 'b-112-vfm', 'B112VFM', '  B 112 VFM  ']) {
      expect(canonicalPlateClient(form), form).toBe('B-112-VFM');
    }
  });

  it('refuses text that is not a plate', () => {
    // The server keeps unrecognised text so a backfill cannot destroy the fleet's odd entries.
    // Here a person is adding a lorry, and a row that can never match an aviz is worthless.
    expect(canonicalPlateClient('camionul lui Gigi')).toBeNull();
    expect(canonicalPlateClient('XY 12 ABC')).toBeNull();
    expect(canonicalPlateClient('')).toBeNull();
    expect(canonicalPlateClient(null)).toBeNull();
  });

  it('takes a two-letter county', () => {
    expect(canonicalPlateClient('CJ 12 ABC')).toBe('CJ-12-ABC');
  });
});

describe('parseMmaKg', () => {
  it('reads kilograms', () => {
    expect(parseMmaKg('40000')).toBe(40000);
    expect(parseMmaKg('40.000')).toBe(40000);
    expect(parseMmaKg(' 26000 ')).toBe(26000);
  });

  it('reads a figure too small to be a lorry as tonnes', () => {
    // Tonnes are what people say out loud. Storing 40 as kilograms would put every trip in the
    // cheapest bracket, which is the error that costs the most and shows the least.
    expect(parseMmaKg('40')).toBe(40000);
    expect(parseMmaKg('7,5')).toBe(7500);
    expect(parseMmaKg('26')).toBe(26000);
  });

  it('is null when there is nothing usable', () => {
    expect(parseMmaKg('')).toBeNull();
    expect(parseMmaKg('   ')).toBeNull();
    expect(parseMmaKg('greu')).toBeNull();
    expect(parseMmaKg('0')).toBeNull();
    expect(parseMmaKg('-5')).toBeNull();
    expect(parseMmaKg(null)).toBeNull();
  });

  it('keeps a real kilogram figure exactly', () => {
    // 1000 is the boundary: at or above it the number is taken at face value.
    expect(parseMmaKg('1000')).toBe(1000);
    expect(parseMmaKg('999')).toBe(999000);
  });
});

describe('mmaLabel', () => {
  it('shows kilograms and tonnes together', () => {
    expect(mmaLabel(40000)).toMatch(/40/);
    expect(mmaLabel(40000)).toMatch(/t\)/);
  });

  it('has something to show for nothing', () => {
    expect(mmaLabel(null)).toBe('—');
    expect(mmaLabel('')).toBe('—');
  });
});
