import { describe, expect, it } from 'vitest';
import { correctionsForReExtract } from './documents.js';
import { reExtract } from '../lib/ocr/extract.js';

// Delivery street unreadable on the page; the office typed the route in Editează.
const RAW = [
  'Expeditor',
  'Site: BOI Bolintin',
  'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0072101\tData avizului de expeditie 21.10.2026',
  'Adresa de livrare\tClient',
  'GIULESTI BUILD SRL\tC23902101 GIULESTI BUILD SRL',
  'Ca1ea Giu1esti, nr. 1-3\tCa1ea Giu1esti, nr. 1-3',
  'Bucuresti Sector 6 RO 060251\tBucuresti Sector 6 RO 060251',
  'Comanda de transport TPO-0037101\tPlacuta de inmatriculare B 47 RAI / B 318 RAI',
  'Baumit Romania Com SRL',
].join('\n');

const OCR_ROUTE = 'Str. Republicii nr. 1F, Bolintin-Deal / Bucuresti';
const TYPED_ROUTE = 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti';

// The row as Editează leaves it: the column has the typed route, values still the OCR read.
const DOC = {
  ruta_transport: TYPED_ROUTE,
  cantitate_marfa: '12',
  data_efectuare_cursa: new Date(2026, 9, 21),
  corrected_fields: ['ruta_transport', 'cantitate_marfa', 'data_efectuare_cursa'],
  extracted_data: { values: { ruta_transport: OCR_ROUTE, quantity: '168', numar_tpo: 'TPO-0037101' } },
};

describe('Re-extrage keeps what the office typed', () => {
  it('takes corrected fields from the columns, not the stale OCR values', () => {
    const corrections = correctionsForReExtract(DOC);
    expect(corrections.ruta_transport).toBe(TYPED_ROUTE);
    expect(corrections.quantity).toBe(12);
    // A pg DATE comes back as the calendar day the office saw, not the day before.
    expect(corrections.data_efectuare_cursa).toBe('2026-10-21');
    // Fields nobody touched still come from the read.
    expect(corrections.numar_tpo).toBe('TPO-0037101');
  });

  it('puts the typed route back after a fresh read', () => {
    const merged = reExtract(RAW, {
      documentType: 'aviz',
      corrections: correctionsForReExtract(DOC),
      correctedFields: DOC.corrected_fields,
    });
    expect(merged.values.ruta_transport).toBe(TYPED_ROUTE);
  });

  it('leaves an uncorrected row to the read', () => {
    expect(correctionsForReExtract({ extracted_data: { values: { ruta_transport: OCR_ROUTE } } }))
      .toEqual({ ruta_transport: OCR_ROUTE });
  });
});
