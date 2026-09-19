import { describe, expect, it } from 'vitest';
import { parseCodeRows } from './codeImport.js';

describe('parseCodeRows observation validation', () => {
  it('normalises trailing * and keeps code + description', () => {
    const { codes, skipped } = parseCodeRows([
      ['Cod', 'Descriere'],
      ['IF*', 'Ilfov'],
      ['Z:B*', 'Zona B'],
    ]);
    expect(skipped).toEqual([]);
    expect(codes.map((c) => c.code)).toEqual(['IF', 'Z:B']);
  });

  it('skips rows without a description and free-text codes', () => {
    const { codes, skipped } = parseCodeRows([
      ['Cod', 'Descriere'],
      ['pepep', ''],
      ['Așteptare', 'Așteptare'],
      ['DM', 'Descărcare macara'],
    ]);
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe('DM');
    expect(skipped.length).toBeGreaterThanOrEqual(2);
  });
});
