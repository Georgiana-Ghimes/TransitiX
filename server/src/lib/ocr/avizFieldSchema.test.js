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
  it('marks TPO/auto/date/document as critical OCR fields', () => {
    expect(fieldMeta('numar_tpo').critical).toBe(true);
    expect(fieldMeta('numar_auto').critical).toBe(true);
    expect(fieldMeta('data_efectuare_cursa').critical).toBe(true);
    // Wrong digit on PSL still looks like a real aviz number (#88).
    expect(fieldMeta('numar_document_marfa').critical).toBe(true);
    expect(fieldMeta('valoare_tpo').source).toBe('ocr');
    expect(fieldMeta('km_parcursi').source).toBe('ocr');
    expect(fieldMeta('observatii').source).toBe('manual');
  });

  it('treats 80% OCR as auto (aligned with ACCEPT_CONFIDENCE) (#85)', () => {
    expect(confidenceBand('numar_tpo', 0.80)).toBe(ROUTING.AUTO);
    expect(confidenceBand('numar_tpo', 0.79)).toBe(ROUTING.HITL_OPTIONAL);
    expect(confidenceBand('numar_tpo', 0.54)).toBe(ROUTING.HITL_REQUIRED);
    expect(confidenceBand('ruta_transport', 0.80)).toBe(ROUTING.AUTO);
    expect(confidenceBand('ruta_transport', 0.55)).toBe(ROUTING.HITL_OPTIONAL);
    expect(confidenceBand('ruta_transport', 0.49)).toBe(ROUTING.HITL_REQUIRED);
  });

  it('exposes documented band constants', () => {
    expect(CRITICAL_BANDS.auto).toBe(0.80);
    expect(DEFAULT_BANDS.auto).toBe(0.80);
    expect(DEFAULT_BANDS.optional).toBe(0.50);
    expect(CRITICAL_BANDS.optional).toBe(0.55);
  });

  it('picks the worst routing', () => {
    expect(worstRouting(ROUTING.AUTO, ROUTING.HITL_OPTIONAL)).toBe(ROUTING.HITL_OPTIONAL);
    expect(worstRouting(ROUTING.HITL_OPTIONAL, ROUTING.HITL_REQUIRED)).toBe(ROUTING.HITL_REQUIRED);
  });
});
