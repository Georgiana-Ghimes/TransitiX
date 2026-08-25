import { describe, expect, it } from 'vitest';
import {
  findDriverForUser,
  formatDate,
  isActiveTripStatus,
  toFiniteNumber,
} from './utils.js';

describe('formatDate', () => {
  it('formats YYYY-MM-DD as RO date without timezone shift', () => {
    expect(formatDate('2026-08-14')).toBe('14.08.2026');
  });

  it('handles ISO strings by slicing date part only', () => {
    expect(formatDate('2026-01-05T22:00:00.000Z')).toBe('05.01.2026');
  });

  it('returns dash for empty values', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate('')).toBe('-');
  });
});

describe('isActiveTripStatus', () => {
  it('includes dispatcher-active statuses', () => {
    expect(isActiveTripStatus('alocata')).toBe(true);
    expect(isActiveTripStatus('in_tranzit')).toBe(true);
  });

  it('excludes terminal or planning statuses', () => {
    expect(isActiveTripStatus('planificata')).toBe(false);
    expect(isActiveTripStatus('livrata')).toBe(false);
  });
});

describe('findDriverForUser', () => {
  const drivers = [
    { id: '1', user_id: 'u1', email: 'a@test.ro', name: 'A' },
    { id: '2', email: 'b@test.ro', name: 'B' },
  ];

  it('matches by user_id first', () => {
    expect(findDriverForUser(drivers, { id: 'u1', email: 'x@test.ro' })?.id).toBe('1');
  });

  it('falls back to email match', () => {
    expect(findDriverForUser(drivers, { id: 'u9', email: 'b@test.ro' })?.id).toBe('2');
  });

  it('returns null when no match', () => {
    expect(findDriverForUser(drivers, { id: 'u9', email: 'z@test.ro' })).toBeNull();
    expect(findDriverForUser(null, { id: 'u1' })).toBeNull();
  });
});

describe('toFiniteNumber', () => {
  it('tells "not set" apart from zero', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber('0')).toBe(0);
  });

  it('parses numeric strings, as pg returns for NUMERIC columns', () => {
    expect(toFiniteNumber('0.60')).toBe(0.6);
    expect(toFiniteNumber('44.4268')).toBe(44.4268);
  });

  it('returns null for values that are not numbers', () => {
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber({})).toBeNull();
  });
});
