import { describe, expect, it } from 'vitest';
import {
  appendObservationCode,
  joinObservationCodes,
  normalizeObservationCode,
  validateObservationCodeInput,
} from './observationCodes.js';

describe('normalizeObservationCode', () => {
  it('strips trailing * used only as a report separator', () => {
    expect(normalizeObservationCode('IF*')).toBe('IF');
    expect(normalizeObservationCode('Z:B*')).toBe('Z:B');
    expect(normalizeObservationCode('  zb* ')).toBe('ZB');
  });
});

describe('validateObservationCodeInput', () => {
  it('requires code and description', () => {
    expect(validateObservationCodeInput({ code: 'pepep' }).ok).toBe(false);
    expect(validateObservationCodeInput({ code: 'IF', label: 'Ilfov' })).toEqual({
      ok: true,
      code: 'IF',
      label: 'Ilfov',
    });
  });

  it('rejects free text and stored separators', () => {
    expect(validateObservationCodeInput({ code: 'așteptare', label: 'x' }).ok).toBe(false);
    expect(validateObservationCodeInput({ code: 'IF/ZB', label: 'x' }).ok).toBe(false);
    expect(validateObservationCodeInput({ code: 'Z:B*', label: 'Zona B' })).toEqual({
      ok: true,
      code: 'Z:B',
      label: 'Zona B',
    });
  });
});

describe('appendObservationCode', () => {
  it('joins with * only when building the Observații value', () => {
    expect(appendObservationCode('', 'IF')).toBe('IF');
    expect(appendObservationCode('IF', 'Z:B')).toBe('IF*Z:B');
    expect(appendObservationCode('IF*Z:B', 'IF')).toBe('IF*Z:B');
  });

  it('migrates a legacy space-separated list', () => {
    expect(appendObservationCode('IF ZB', 'DM')).toBe('IF*ZB*DM');
  });
});

describe('joinObservationCodes', () => {
  it('dedupes and joins', () => {
    expect(joinObservationCodes(['IF*', 'ZB', 'IF'])).toBe('IF*ZB');
  });
});
