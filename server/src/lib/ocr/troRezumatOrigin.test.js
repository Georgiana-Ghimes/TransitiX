/**
 * TRO "Aviz de expediție rezumat" — the title and the date print right under Expeditor:
 *
 *   Expeditor / Site MIL / Depozit NEAMTIU / # Aviz de expediție rezumat: TPO-… /
 *   Data aviz de expediție 20.10.2026 15:19 / Adresa de livrare …
 *
 * The street parser read `expeditie 20` as a street (`Str. Expeditie nr. 20`) on 15 of the
 * 16 real TRO avize in qa/avize_reale; because the origin then looked `street`-read, the
 * Site/Depozit origin (MIL-NEAMTIU) and the learned-address memory never got a chance.
 *
 * Fixture: real OCR text of those 16 pages (local QA DB), driver names / phones / plates
 * replaced. `bug_before` is what the parser produced before the fix.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expeditorOrigin,
  parseBaumitAviz,
  parseDeliveryAddress,
  parseExpeditorAddress,
} from '../avizOcr.js';
import { sanitizeOcrText } from './normalizeOcrText.js';
import { applyAddressMemory } from './addressMemory.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/tro-rezumat-origin.json');
const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));

describe('TRO rezumat: document title + date are never the Expeditor street (real OCR)', () => {
  it('covers the 16 TRO avize from the real batch', () => {
    expect(cases).toHaveLength(16);
    expect(cases.filter((c) => /expeditie/i.test(c.bug_before))).toHaveLength(15);
  });

  for (const c of cases) {
    describe(c.slug, () => {
      for (const [label, text] of [['raw', c.raw_text], ['sanitized', sanitizeOcrText(c.raw_text)]]) {
        it(`${label}: origin is the Site/Depozit (${c.expect_origin}), not "${c.bug_before}"`, () => {
          const route = parseBaumitAviz(text).ruta_transport || '';
          const [origin] = route.split(' / ');
          expect(origin).toBe(c.expect_origin);
          expect(route).not.toMatch(/expedi/i);
          expect(route).toContain(c.expect_delivery_substr);
        });

        it(`${label}: Expeditor is not reported as street-read`, () => {
          const block = parseExpeditorAddress(text);
          expect(block.streetName || '').not.toMatch(/expedi/i);
          expect(expeditorOrigin(text).status).not.toBe('street');
        });
      }
    });
  }
});

describe('title / date guard is context-bound', () => {
  it('keeps a real "Str. Expediției" street under Expeditor', () => {
    const text = [
      'Expeditor',
      'Site: PLO Ploiesti',
      'Str. Expediției nr. 4 Ploiești RO 100001 ROU',
      'Aviz de expediție: PSL-0099001',
      'Data aviz de expediție 20.10.2026 15:19',
      'Adresa de livrare',
      'Str. Industriei, nr. 7 Bolintin-Deal RO 087015 ROU',
      'Comanda de transport TPO-0099001',
    ].join('\n');
    const block = parseExpeditorAddress(text);
    expect(block.streetName).toBe('expeditiei');
    expect(block.houseNumber).toBe('4');
    expect(parseBaumitAviz(text).ruta_transport).toMatch(/^Str\. Expeditiei nr\. 4, Ploiesti \/ Str\. Industriei nr\. 7/);
  });

  it('keeps a real "Str. Expediției" delivery street next to the document date', () => {
    const text = [
      'Expeditor',
      'Site MIL',
      'Depozit NEAMTIU',
      'Aviz de expediție rezumat: TPO-0099002',
      'Data aviz de expediție 21.10.2026 08:05',
      'Adresa de livrare',
      'Str. Expediției, nr. 12 Ploiești RO 100002 ROU',
      'Termeni de livrare DAP',
    ].join('\n');
    expect(parseDeliveryAddress(text).streetName).toBe('expeditiei');
    expect(parseBaumitAviz(text).ruta_transport).toBe('MIL-NEAMTIU / Str. Expeditiei nr. 12, Ploiesti');
  });

  it('never turns the day of a date into a house number', () => {
    const text = [
      'Expeditor',
      'Site: BOL Bolintin',
      'Republicii 20.10.2026 Bolintin-Deal RO 087015 ROU',
      'Adresa de livrare',
      'Str. Industriei, nr. 7 Bolintin-Deal RO 087015 ROU',
    ].join('\n');
    expect(parseExpeditorAddress(text).houseNumber).toBeNull();
  });

  it('keeps house ranges and wings that look a bit like dates', () => {
    const text = [
      'Expeditor',
      'Site: BOL Bolintin',
      'Str. Industriei nr. 7 Bolintin-Deal RO 087015 ROU',
      'Adresa de livrare',
      'Str. Hornbach, nr. 17-21 Domnesti RO 077090 ROU',
    ].join('\n');
    expect(parseDeliveryAddress(text).houseNumber).toBe('17-21');
  });
});

describe('unreadable street after the title is reported as unread, so memory can fill it', () => {
  // TRO-like head: title + date between Site and a scanner-mangled street; postcode survived.
  const PAGE = [
    'Expeditor',
    'Site: BOL Bolintin',
    'Data aviz de expedi!ie 20.10.2026 15:31',
    'Str.-.epuolicii, nr. IF Bolintin-Deal RO 087015 ROU',
    'Adresa de livrare',
    'MIL DEPOZIT Militari',
    'Bvd. Iuliu Maniu, nr. 220 Bucuresti Sector 6 RO 061101 ROU',
    'Comanda de transport TPO-0099003',
  ].join('\n');
  const REPUBLICII = {
    id: 'a1',
    role: 'origin',
    postcode: '087015',
    locality: 'Bolintin-Deal',
    street_name: 'republicii',
    display: 'Str. Republicii nr. 1F, Bolintin-Deal',
    source: 'parsed',
    seen_count: 3,
    verified: false,
    disabled: false,
  };

  it('does not claim street_read', () => {
    const origin = expeditorOrigin(PAGE);
    expect(origin.status).not.toBe('street');
    expect(origin.block.postcode).toBe('087015');
  });

  it('memory fills the depot street', () => {
    const trace = [];
    const { values, address } = applyAddressMemory({}, PAGE, [REPUBLICII], { trace });
    expect(address?.id).toBe('a1');
    expect(values.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bvd. Iuliu Maniu nr. 220, Bucuresti');
    expect(trace.find((t) => t.step === 'origin_memory')?.reason).not.toBe('street_read');
  });
});
