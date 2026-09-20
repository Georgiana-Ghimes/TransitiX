import { describe, expect, it } from 'vitest';
import {
  mergeVlmIntoExtraction,
  parseVlmJson,
  VLM_AVIZ_KEYS,
} from './vlmCorrect.js';
import { extractDocument } from './extract.js';

describe('parseVlmJson', () => {
  it('parses raw JSON', () => {
    expect(parseVlmJson('{"numar_tpo":"TPO-1"}')).toEqual({ numar_tpo: 'TPO-1' });
  });

  it('parses fenced JSON', () => {
    expect(parseVlmJson('```json\n{"numar_auto":"B-1-AAA"}\n```')).toEqual({
      numar_auto: 'B-1-AAA',
    });
  });

  it('returns null on garbage', () => {
    expect(parseVlmJson('nu e json')).toBeNull();
  });
});

describe('mergeVlmIntoExtraction', () => {
  it('fills missing fields from the VLM and marks them for review', () => {
    const base = extractDocument('AVIZ fara coduri utile 12.03.2026');
    const merged = mergeVlmIntoExtraction(base, {
      numar_tpo: 'TPO-0025803',
      numar_auto: 'B-330-SRS',
      delivery_street: 'Viilor',
      delivery_street_type: 'sosea',
      delivery_house_number: '52',
      delivery_locality: 'Bucuresti',
    });
    expect(merged.values.numar_tpo).toBe('TPO-0025803');
    expect(merged.fields.numar_tpo.source).toBe('vlm');
    expect(merged.fields.numar_tpo.status).toBe('review');
    expect(merged.values.delivery_address).toMatchObject({
      streetName: 'viilor',
      streetType: 'sosea',
      houseNumber: '52',
      locality: 'Bucuresti',
    });
    expect(merged.vlm.filled).toEqual(expect.arrayContaining(['numar_tpo', 'numar_auto']));
    expect(merged.needs_review).toBe(true);
  });

  it('keeps an accepted OCR value and records a conflict when VLM disagrees', () => {
    const base = extractDocument(`
      Aviz de expeditie PSL-0044362
      Comanda de transport TPO-0025629
      Placuta de inmatriculare B 330 SRS
      Data avizului de expeditie 12.03.2026
    `);
    expect(base.values.numar_tpo).toBeTruthy();
    const ocrTpo = base.values.numar_tpo;
    const merged = mergeVlmIntoExtraction(base, { numar_tpo: 'TPO-9999999' });
    expect(merged.values.numar_tpo).toBe(ocrTpo);
    expect(merged.vlm.conflicts).toContain('numar_tpo');
  });

  it('exposes the aviz key list for prompts', () => {
    expect(VLM_AVIZ_KEYS).toContain('delivery_street');
  });

  it('coerces RO weighbridge strings into kg numbers', () => {
    const base = extractDocument('AVIZ fara greutate');
    const merged = mergeVlmIntoExtraction(base, {
      gross_weight_kg: '15,744,00',
      quantity: '15.744,00',
    });
    expect(merged.values.gross_weight_kg).toBe(15744);
    expect(merged.values.quantity).toBe(15744);
  });
});
