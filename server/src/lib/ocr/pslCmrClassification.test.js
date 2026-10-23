/**
 * BUG 4: Baumit PSL avize (WhatsApp photos, screenshots, vector PDFs) detected as `aviz_cmr`.
 *
 * Every PSL aviz ends with the pallet footer "Paleti la locul de livrare: predare … / preluare …"
 * and prints "Greutate brută". `looksLikeCmrDocument` took "locul de livrare" + "greutate brută"
 * as the numbered CMR boxes, so the CMR profile (0.93) beat the PSL code bonus (0.88) whenever
 * the word "Baumit" was not on the page (photos crop the header; the test lot is co-branded).
 * As `aviz_cmr` the page got no route at extract, `low` route confidence, and no address memory
 * (`profile_not_supported`).
 *
 * Fixture: real OCR text of the 15 PSL pages and the handwritten CMR (WA0041) from
 * qa/avize_reale (local QA DB, ocr_text_cache), driver names / phones / plates replaced.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBaumitAviz, repairAvizFromStored } from '../avizOcr.js';
import { applyAddressMemory, isAddressMemoryProfile } from './addressMemory.js';
import { extractDocument } from './extract.js';
import { sanitizeOcrText } from './normalizeOcrText.js';
import { detectProfile, looksLikeCmrDocument } from './profiles.js';
import { readRepairAttempt, routeSourceOf } from './routeTrace.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, '__fixtures__/psl-cmr-misclassified.json'), 'utf8'));
const troCases = JSON.parse(readFileSync(join(here, '__fixtures__/tro-rezumat-origin.json'), 'utf8'));
const psl = cases.filter((c) => c.kind === 'psl');
const cmr = cases.filter((c) => c.kind === 'cmr');

describe('PSL avize are not CMR (real OCR)', () => {
  it('covers the real batch: 15 PSL (13 were aviz_cmr) and the handwritten CMR', () => {
    expect(psl).toHaveLength(15);
    expect(psl.filter((c) => c.bug_profile === 'aviz_cmr')).toHaveLength(13);
    expect(cmr).toHaveLength(1);
  });

  for (const c of psl) {
    describe(`${c.slug} ${c.expect_doc}`, () => {
      for (const [label, text] of [['raw', c.raw_text], ['sanitized', sanitizeOcrText(c.raw_text)]]) {
        it(`${label}: detected as the PSL profile, not CMR`, () => {
          expect(looksLikeCmrDocument(text)).toBe(false);
          expect(detectProfile(text, { documentType: 'aviz' }).profile?.id).toBe('aviz_baumit_psl');
        });

        it(`${label}: extract fills the PSL route and document number`, () => {
          const out = extractDocument(text, { documentType: 'aviz' });
          expect(out.profile_id).toBe('aviz_baumit_psl');
          expect(out.values.numar_document_marfa).toBe(c.expect_doc);
          const [origin, ...legs] = String(out.values.ruta_transport || '').split(' / ');
          expect(origin).toBe(c.expect_origin);
          expect(legs.join(' / ')).toContain(c.expect_delivery_substr);
          expect(isAddressMemoryProfile(out.profile_id)).toBe(true);
        });
      }
    });
  }
});

describe('real CMR stays CMR', () => {
  for (const c of cmr) {
    it(`${c.slug}: handwritten CMR is still aviz_cmr`, () => {
      expect(looksLikeCmrDocument(c.raw_text)).toBe(true);
      expect(detectProfile(c.raw_text, { documentType: 'aviz' }).profile?.id).toBe('aviz_cmr');
    });
  }

  it('CMR boxes without the word CMR still count (locul de livrare + greutate brută)', () => {
    const text = [
      'Expeditor: Firma Test SRL',
      'Destinatar: Client Test SRL',
      '3. Locul de livrare: Bucuresti, Sos. Giurgiului nr. 120',
      '4. Locul de incarcare: Ploiesti',
      '11. Greutate bruta 14844 kg',
    ].join('\n');
    expect(looksLikeCmrDocument(text)).toBe(true);
    expect(detectProfile(text, { documentType: 'aviz' }).profile?.id).toBe('aviz_cmr');
  });

  it('a CMR that lists a PSL aviz among the annexed documents stays aviz_cmr', () => {
    const text = [
      'SCRISOARE DE TRASURA INTERNATIONALA CMR Nr. 0247399',
      '1 Expeditor Firma Test SRL Str. Fabricii nr. 14, Ploiesti',
      '3 Locul de livrare Bucuresti Sector 4, Sos. Giurgiului 120',
      '5 Documente anexate Aviz de expeditie PSL-0062999',
      '11 Greutate bruta, kg 14 844',
    ].join('\n');
    expect(looksLikeCmrDocument(text)).toBe(true);
    expect(detectProfile(text, { documentType: 'aviz' }).profile?.id).toBe('aviz_cmr');
  });

  it('the pallet footer alone does not make a CMR, in its OCR variants', () => {
    for (const footer of [
      'Paleti la locul de livrare: predare ..... pce / preluare ..... pce',
      'Paleti ia locul de livrare:\t/',
      'Paleți la locul de livrare: predare / preluare',
    ]) {
      expect(looksLikeCmrDocument(`Expeditor\nSite: BOL Bolintin\n${footer}\nGreutate brută: 12,812.43 kg`)).toBe(false);
    }
  });
});

describe('TRO avize keep their profile', () => {
  for (const c of troCases) {
    it(`${c.slug}: aviz_baumit_tro`, () => {
      expect(detectProfile(c.raw_text, { documentType: 'aviz' }).profile?.id).toBe('aviz_baumit_tro');
    });
  }
});

describe('address memory on the reclassified PSL pages', () => {
  // The learned origins of the local QA company for postcode 087015: Republicii 1F (corrected,
  // the most seen), Industriei 7 and a junk read. The PSL pages print Industriei 7 clearly, so
  // memory must leave the origin alone — never swap it for the more popular Republicii 1F.
  const base = { postcode: '087015', locality: 'Bolintin-Deal', verified: false, disabled: false, role: 'origin' };
  const known = [
    { ...base, id: 'o1', street_name: 'republicii', display: 'Str. Republicii nr. 1F, Bolintin-Deal', source: 'corrected', seen_count: 7 },
    { ...base, id: 'o2', street_name: 'industriei', display: 'Str. Industriei nr. 7, Bolintin-Deal', source: 'parsed', seen_count: 2 },
    { ...base, id: 'o3', street_name: 'bolintin', display: 'Str. Bolintin nr. 30U, Deal', source: 'parsed', seen_count: 1 },
  ];

  for (const c of psl) {
    it(`${c.slug}: origin read from the page, memory does not replace it`, () => {
      const out = extractDocument(c.raw_text, { documentType: 'aviz' });
      const trace = [];
      const memory = applyAddressMemory(out.values, c.raw_text, known, { trace });
      expect(memory.address).toBeNull();
      expect(memory.values.ruta_transport).toBe(out.values.ruta_transport);
      expect(trace.find((a) => a.step === 'origin_memory')).toMatchObject({ result: 'skipped' });
    });
  }
});

describe('extract-time route source matches the read surfaces', () => {
  it('names the read-time parse when the profile left the route empty', () => {
    const c = psl[0];
    const readRoute = repairAvizFromStored({
      ruta_transport: null, corrected_fields: [], extracted_data: { raw_text: c.raw_text },
    }).ruta_transport;
    expect(readRoute).toBe(parseBaumitAviz(c.raw_text).ruta_transport);
    expect(routeSourceOf({ route: null })).toBe('none');
    expect(routeSourceOf({ route: null, readRoute })).toBe('parser');
    expect(readRepairAttempt(null, readRoute)).toEqual({ step: 'read_repair', result: 'used', reason: 'profile_route_empty' });
  });

  it('changes nothing when the profile had a route, or nothing can be read', () => {
    expect(routeSourceOf({ route: 'A / B', readRoute: 'C / D' })).toBe('parser');
    expect(routeSourceOf({ route: '', readRoute: '' })).toBe('none');
    expect(readRepairAttempt('A / B', 'C / D')).toBeNull();
    expect(readRepairAttempt(null, null)).toBeNull();
    expect(routeSourceOf({ memoryUsed: true, readRoute: 'x' })).toBe('memory');
  });
});
