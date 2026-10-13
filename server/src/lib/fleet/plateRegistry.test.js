import { describe, expect, it, vi } from 'vitest';
import {
  applyFleetPlateCorrection,
  digitEditDistance,
  pickFleetPlateCorrection,
  plateParts,
  resolveOcrPlateAgainstFleet,
  runDbQuery,
} from './plateRegistry.js';

describe('plateParts / digitEditDistance', () => {
  it('splits a RO plate', () => {
    expect(plateParts('B-29-NKL')).toEqual({ county: 'B', num: '29', series: 'NKL' });
    expect(plateParts('b 29 nkl')).toBeNull();
  });

  it('counts single-digit diffs', () => {
    expect(digitEditDistance('23', '29')).toBe(1);
    expect(digitEditDistance('23', '23')).toBe(0);
    expect(digitEditDistance('23', '99')).toBe(2);
    expect(digitEditDistance('23', '2')).toBe(99);
  });
});

describe('pickFleetPlateCorrection (#78)', () => {
  it('repairs B-23-NKL → B-29-NKL when that tractor is on Autoturisme', () => {
    // IMG-20261002-WA0045 night photo: 9 read as 3; trailer B-81-NKL stays.
    expect(pickFleetPlateCorrection('B-23-NKL', ['B-29-NKL', 'B-81-NKL'])).toBe('B-29-NKL');
  });

  it('does nothing when the OCR plate is already in the fleet', () => {
    expect(pickFleetPlateCorrection('B-29-NKL', ['B-29-NKL', 'B-81-NKL'])).toBeNull();
  });

  it('does nothing when two fleet plates are one digit away', () => {
    expect(pickFleetPlateCorrection('B-23-NKL', ['B-29-NKL', 'B-28-NKL'])).toBeNull();
  });

  it('does nothing when no fleet neighbour exists', () => {
    expect(pickFleetPlateCorrection('B-23-NKL', ['B-81-NKL', 'IF-51-GTR'])).toBeNull();
  });

  it('rewrites only the tractor in a tractor/trailer pair', () => {
    const fixed = applyFleetPlateCorrection('B-23-NKL / B-81-NKL', ['B-29-NKL', 'B-81-NKL']);
    expect(fixed).toEqual({
      numarAuto: 'B-29-NKL / B-81-NKL',
      repaired: true,
      from: 'B-23-NKL',
      to: 'B-29-NKL',
    });
  });
});

describe('resolveOcrPlateAgainstFleet db handle (#78 reopen)', () => {
  it('accepts the bare query(text, params) from db.js, not only pool.query', async () => {
    // extractBatchDocuments used to pass `query` → db.query undefined → silent catch.
    const queryFn = vi.fn(async () => ({ rows: [{ plate: 'B-29-NKL' }, { plate: 'B-81-NKL' }] }));
    const fixed = await resolveOcrPlateAgainstFleet(
      queryFn,
      'company-1',
      'B-23-NKL / B-81-NKL',
    );
    expect(queryFn).toHaveBeenCalled();
    expect(fixed.repaired).toBe(true);
    expect(fixed.numarAuto).toBe('B-29-NKL / B-81-NKL');
  });

  it('accepts pool-shaped { query }', async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [{ plate: 'B-29-NKL' }] })),
    };
    expect(await runDbQuery(db, 'SELECT 1', [])).toEqual({ rows: [{ plate: 'B-29-NKL' }] });
    const fixed = await resolveOcrPlateAgainstFleet(db, 'c1', 'B-23-NKL / B-81-NKL');
    expect(fixed.numarAuto).toBe('B-29-NKL / B-81-NKL');
  });
});
