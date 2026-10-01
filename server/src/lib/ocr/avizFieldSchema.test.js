import { describe, expect, it } from 'vitest';
import {
  CRITICAL_BANDS,
  DEFAULT_BANDS,
  ROUTING,
  confidenceBand,
  fieldMeta,
  worstRouting,
} from './avizFieldSchema.js';

describe('avizFieldSchema', () => {
  it('marks TPO/auto/date as critical OCR fields', () => {
    expect(fieldMeta('numar_tpo').critical).toBe(true);
    expect(fieldMeta('numar_auto').critical).toBe(true);
    expect(fieldMeta('data_efectuare_cursa').critical).toBe(true);
    expect(fieldMeta('valoare_tpo').source).toBe('ocr');
    expect(fieldMeta('km_parcursi').source).toBe('ocr');
    expect(fieldMeta('observatii').source).toBe('manual');
  });

  it('uses stricter bands on critical fields', () => {
    expect(confidenceBand('numar_tpo', 0.93)).toBe(ROUTING.HITL_OPTIONAL);
    expect(confidenceBand('numar_tpo', 0.96)).toBe(ROUTING.AUTO);
    expect(confidenceBand('ruta_transport', 0.93)).toBe(ROUTING.AUTO);
    expect(confidenceBand('ruta_transport', 0.75)).toBe(ROUTING.HITL_OPTIONAL);
    expect(confidenceBand('ruta_transport', 0.5)).toBe(ROUTING.HITL_REQUIRED);
  });

  it('exposes documented band constants', () => {
    expect(CRITICAL_BANDS.auto).toBe(0.95);
    expect(DEFAULT_BANDS.optional).toBe(0.70);
  });

  it('picks the worst routing', () => {
    expect(worstRouting(ROUTING.AUTO, ROUTING.HITL_OPTIONAL)).toBe(ROUTING.HITL_OPTIONAL);
    expect(worstRouting(ROUTING.HITL_OPTIONAL, ROUTING.HITL_REQUIRED)).toBe(ROUTING.HITL_REQUIRED);
  });
});
