import { describe, expect, it } from 'vitest';
import { normalizeTemplateOptions, wantsMergeTpoCells } from './templateOptions.js';

describe('templateOptions', () => {
  it('defaults merge_tpo_cells to false', () => {
    expect(normalizeTemplateOptions(null)).toEqual({ merge_tpo_cells: false });
    expect(normalizeTemplateOptions({})).toEqual({ merge_tpo_cells: false });
  });

  it('preserves unknown keys and coerces the flag', () => {
    expect(normalizeTemplateOptions({ merge_tpo_cells: 1, foo: 'bar' })).toEqual({
      foo: 'bar',
      merge_tpo_cells: true,
    });
  });

  it('wantsMergeTpoCells reads template.options', () => {
    expect(wantsMergeTpoCells({ options: { merge_tpo_cells: true } })).toBe(true);
    expect(wantsMergeTpoCells({ options: {} })).toBe(false);
  });
});
