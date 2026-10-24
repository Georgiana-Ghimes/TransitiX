/**
 * Route quality fixes A + B (handover „Noi, din runda 2 pe VM").
 *
 * A — route confidence: a route with a missing leg (origin or delivery only a town / a bare site
 *     code), an unreadable street or house, a street that is really a firm / logo, or a leg filled
 *     from the company's memory is `low` (needs review), never `ok`. The route text is not changed.
 *     Reason codes go on route_trace.confidence.reasons.
 * B — street parser: the client / branch name above the street is not the street (Reabilitare
 *     Lohn, Brico Militari, Rockwool, Arabesque- Galati, CALEA 13 BUILD SRL), street names that
 *     start with a day (`1 Decembrie`, `13 Septembrie`), `Bolintin Deal` without the hyphen, junk
 *     (`nr.Z5-ALeo`, `5tr. ~~~`), `Bulevard` / `Alee` / `Splaiul` / `Intrare` printed as the type.
 *
 * Fixture: real OCR of the prod / VM test pages (local QA dumps; delegate names, phones and plates
 * replaced) plus the synthetic VM round-2 pages. `display_before` / `confidence_before` are what
 * HEAD 5e4081a showed in the list for the same text.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyRouteConfidenceToField,
  fieldConfidenceForUi,
  parseBaumitAviz,
  parseDeliveryAddress,
  repairAvizFromStored,
  routeConfidenceReasons,
} from '../avizOcr.js';
import { extractDocument } from './extract.js';
import { sanitizeOcrText } from './normalizeOcrText.js';
import { routeConfidence, routeWithCompanyMemory } from './routeDecorate.js';
import { buildRouteTrace, routeTraceEventDetail } from './routeTrace.js';
import { deliveryObservationsFromOcr } from './addressMemory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(HERE, '__fixtures__/route-ab-cases.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(join(HERE, '../../../../fixtures/baumit-route-corpus/manifest.json'), 'utf8'));
const troCases = JSON.parse(readFileSync(join(HERE, '__fixtures__/tro-rezumat-origin.json'), 'utf8'));

/** What the /avize list shows for a freshly extracted page (no company memory / rules). */
function listView(raw, { knownAddresses = [], routeRules = [] } = {}) {
  const ext = extractDocument(raw, { documentType: 'aviz' });
  const serialized = repairAvizFromStored({
    ruta_transport: ext.values?.ruta_transport ?? null,
    ocr_profile_id: ext.profile_id,
    field_confidence: ext.fields,
    extracted_data: { raw_text: raw },
  });
  const { ruta, extracted_data, trace } = routeWithCompanyMemory(serialized, { knownAddresses, routeRules });
  let confidence = fieldConfidenceForUi({ ...serialized, ruta_transport: ruta, extracted_data }).ruta_transport;
  // routes/avize.js decorateAviz: a street from the company memory is always amber (#112).
  if (extracted_data?.origin_source === 'memory' || extracted_data?.delivery_source === 'memory') confidence = 'low';
  return {
    profile: ext.profile_id,
    extractRoute: ext.values?.ruta_transport ?? null,
    route: ruta,
    confidence,
    reasons: trace.confidence?.reasons ?? null,
  };
}

/** Synthetic Baumit PSL page (corpus layout): delivery left column, Client column right. */
function pslPage(deliveryLines, { expeditor = 'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU' } = {}) {
  return [
    'Baumit Romania Com SRL',
    'Expeditor',
    'Site: BOL Bolintin',
    expeditor,
    'Aviz de expeditie: PSL-9800001',
    'Data avizului de expeditie: 19.10.2026',
    'Comanda vanzare: SOR-0000000',
    'Adresa de livrare\tClient',
    ...deliveryLines,
    'ROU\tROU',
    'Client factura:\tC23901527 CLIENT TEST SRL',
    'Transportator:\tEKAER',
    'Placuta de inmatriculare\tB 00 TST',
    'Comanda de transport\tTPO-9900001',
    'Produs\tCantitate',
    'FinoGrande 20 kg\t100.00 sac',
    'Greutate bruta 12500 kg',
    'Baumit Romania Com SRL, Sediu: Bucuresti, B-dul Iuliu Maniu nr. 600A, Sector 6, 061129',
  ].join('\n');
}
const ORIGIN = 'Str. Republicii nr. 1F, Bolintin-Deal';
const delivery = (lines) => parseBaumitAviz(sanitizeOcrText(pslPage(lines))).ruta_transport;

describe('A + B on real / VM pages (fixture)', () => {
  it('covers every A and B case of the handover', () => {
    const slugs = cases.map((c) => c.slug);
    for (const s of [
      'b-client-name-reabilitare-lohn', 'b-client-name-brico-militari', 'b-client-name-rockwool',
      'b-1-decembrie', 'b-str-13-septembrie', 'b-calea-13-septembrie-build-srl',
      'b-bolintin-deal-no-hyphen', 'b-junk-house-nr-z5-aleo', 'b-junk-origin-5tr', 'b-bulevard-marasti',
      'a-delivery-town-only', 'a-delivery-street-unreadable', 'a-origin-site-code-only', 'a-one-leg-cut-header',
    ]) expect(slugs).toContain(s);
    // No delegate name / phone survived anonymization.
    const text = JSON.stringify(cases);
    const phones = (text.match(/0\s?7\d{2}[\s.]?\d{3}[\s.]?\d{3}/g) || []).filter((p) => p !== '0700000000');
    expect(phones).toEqual([]);
  });

  for (const c of cases) {
    describe(`${c.slug} (${c.category}): ${c.note}`, () => {
      const view = listView(c.raw_text);

      it(`profile ${c.expect_profile}`, () => {
        expect(view.profile).toBe(c.expect_profile);
      });

      it(`list route: ${c.expect_display_route}`, () => {
        expect(view.route).toBe(c.expect_display_route);
        expect(view.extractRoute).toBe(c.expect_extract_route);
      });

      it(`route confidence ${c.expect_confidence}${c.expect_reasons.length ? ` (${c.expect_reasons.join(', ')})` : ''}`, () => {
        expect(view.confidence).toBe(c.expect_confidence);
        expect(view.reasons).toEqual(expect.arrayContaining(c.expect_reasons));
        if (c.expect_confidence === 'ok') expect(view.reasons).toEqual([]);
      });

      if (c.category === 'B') {
        it(`no longer "${c.display_before}"`, () => {
          expect(view.route).not.toBe(c.display_before);
        });
      }
      if (c.category === 'A') {
        it(`was a silent ok before ("${c.display_before}"), now flagged`, () => {
          expect(c.confidence_before).toBe('ok');
          expect(view.confidence).toBe('low');
        });
      }
      if (c.category === 'guard') {
        it('correct route: same text and still ok', () => {
          expect(view.route).toBe(c.display_before);
          expect(c.confidence_before).toBe('ok');
          expect(view.confidence).toBe('ok');
        });
      }
    });
  }
});

describe('A: no false-low on correct routes', () => {
  it('every baumit-route-corpus page (golden, CP edge, client traps) stays ok', () => {
    const low = corpus
      .map((e) => {
        const raw = sanitizeOcrText(e.raw_text);
        const ext = extractDocument(raw, { documentType: 'aviz' });
        return { slug: e.slug, reasons: routeConfidenceReasons(ext.values.ruta_transport, raw, { profileId: ext.profile_id }) };
      })
      .filter((x) => x.reasons.length);
    expect(low).toEqual([]);
  });

  it('TRO with the depot printed (MIL-<depot>) stays ok; a blank Depozit leaves a bare MIL → low', () => {
    for (const c of troCases) {
      const ext = extractDocument(c.raw_text, { documentType: 'aviz' });
      const reasons = routeConfidenceReasons(ext.values.ruta_transport, c.raw_text, { profileId: ext.profile_id });
      if (c.expect_origin.includes('-')) expect({ slug: c.slug, reasons }).toEqual({ slug: c.slug, reasons: [] });
      else expect(reasons).toEqual(['incomplete_leg']);
    }
  });

  it('an office-corrected route is ok whatever it looks like', () => {
    expect(routeConfidence('BOL / Ciulnita', pslPage(['Ciulnita\tCiulnita']), { profileId: 'aviz_baumit_psl', corrected: true }))
      .toEqual({ status: 'ok', reasons: [] });
  });

  it('a route from a learned rule skips the completeness check (MIL from a rule stays ok)', () => {
    const raw = troCases.find((c) => c.slug === 'tro-rezumat-09').raw_text;
    expect(routeConfidenceReasons('MIL / Bvd. Iuliu Maniu nr. 600A, Bucuresti', raw, { profileId: 'aviz_baumit_tro', learned: true }))
      .toEqual([]);
  });

  it('profiles outside Baumit / CMR keep only the old heuristics', () => {
    expect(routeConfidenceReasons('Ploiesti / Bucuresti', null, { profileId: 'generic' })).toEqual([]);
    expect(routeConfidenceReasons('Ploiesti / Bucuresti', null, { profileId: 'aviz_baumit_psl' })).toContain('incomplete_leg');
  });
});

describe('A: reason codes', () => {
  const psl = { profileId: 'aviz_baumit_psl' };

  it('incomplete_leg: delivery is a town only / origin is a bare site code / one leg', () => {
    expect(routeConfidenceReasons(`${ORIGIN} / Ciulnita`, null, psl)).toContain('incomplete_leg');
    expect(routeConfidenceReasons('BOL / Bvd. Timisoara nr. 26, Bucuresti', null, psl)).toContain('incomplete_leg');
    expect(routeConfidenceReasons(ORIGIN, null, psl)).toContain('incomplete_leg');
    expect(routeConfidenceReasons(`${ORIGIN} / Str. Marasti nr. 57`, null, psl)).toContain('incomplete_leg');
  });

  it('unknown_street: the page prints a street for the leg but none was read', () => {
    const raw = pslPage(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Strada ~~~~ nr. 4\tStr. Aeroportului 120', 'Pantelimon RO 077145\tBucuresti Sector 1 RO 013596']);
    const route = parseBaumitAviz(raw).ruta_transport;
    expect(route).toBe(`${ORIGIN} / Pantelimon`);
    expect(routeConfidenceReasons(route, raw, psl)).toEqual(['unknown_street']);
  });

  it('junk_street: a legal form in the street, an implausible town or house', () => {
    expect(routeConfidenceReasons(`${ORIGIN} / Str. Rockwool Srl Liv nr. 0-100, Bucuresti`, null, psl)).toContain('junk_street');
    expect(routeConfidenceReasons(`${ORIGIN} / Șosea Curtea Domneasca, Nr.z5-Aleo`, null, psl)).toContain('junk_street');
    expect(routeConfidenceReasons(`${ORIGIN} / Str. Unirii nr. ~~5, Bucuresti`, null, psl)).toContain('junk_street');
  });

  it('memory_fill: a street taken from the company memory is never this page\'s own read', () => {
    expect(routeConfidence(`${ORIGIN} / Str. Lacului nr. 12, Dridu`, null, { ...psl, memory: true }))
      .toEqual({ status: 'low', reasons: ['memory_fill'] });
  });

  it('memory_fill on the list: an unreadable origin filled from a trusted address', () => {
    const raw = pslPage(
      ['CS-CONCELEX\tC23901527 CONCELEX SRL', 'Sosea Viilor nr. 52\tStr. Aeroportului 120-130', 'Bucuresti Sector 5 RO 050151\tBucuresti Sector 1 RO 013596'],
      { expeditor: '5tr. ~~~~~~ Bolintin-Deal RO 087015 ROU' },
    );
    const known = [{
      id: 'a1', role: 'origin', postcode: '087015', locality: 'Bolintin-Deal', street_name: 'republicii',
      display: ORIGIN, match_key: 'republicii 1f bolintin-deal', source: 'manual', verified: true, seen_count: 4, disabled: false,
    }];
    const view = listView(raw, { knownAddresses: known });
    expect(view.route).toBe(`${ORIGIN} / Șosea Viilor nr. 52, Bucuresti`);
    expect(view.reasons).toContain('memory_fill');
    expect(view.confidence).toBe('low');
  });

  it('duplicate_leg: the same stop twice (two columns of one photo)', () => {
    expect(routeConfidenceReasons(`${ORIGIN} / Sosea Viilor nr. 52, Bucuresti / Sosea Viilor nr. 52, Bucuresti`, null, psl))
      .toContain('duplicate_leg');
  });

  it('CMR: one leg or printed form labels', () => {
    const cmr = { profileId: 'aviz_cmr' };
    expect(routeConfidenceReasons('Ploiesti', null, cmr)).toContain('incomplete_leg');
    expect(routeConfidenceReasons('Ort und Tag der Übernahme des Gutes / Empfänger', null, cmr)).toEqual(['form_label']);
    expect(routeConfidenceReasons('Ploiești / București Sector 4, Șos. Giurgiului 120', null, cmr)).toEqual([]);
  });

  it('a complete route has no reason', () => {
    expect(routeConfidenceReasons(`${ORIGIN} / Sosea Viilor nr. 52, Bucuresti`, null, psl)).toEqual([]);
    expect(routeConfidenceReasons('MIL-NEAMTIU / Str. Industriei nr. 7, Bolintin-Deal', null, { profileId: 'aviz_baumit_tro' })).toEqual([]);
  });
});

describe('A: extract-time field and trace', () => {
  it('applyRouteConfidenceToField sends a low route to review, keeps an ok one untouched', () => {
    const fields = { ruta_transport: { value: 'x', confidence: 0.92, status: 'ok' } };
    const low = applyRouteConfidenceToField(fields, { route: `${ORIGIN} / Ciulnita`, profileId: 'aviz_baumit_psl' });
    expect(low).toEqual({ status: 'low', reasons: ['incomplete_leg'] });
    expect(fields.ruta_transport).toMatchObject({ confidence: 0.6, status: 'review', route_confidence_reasons: ['incomplete_leg'] });

    const okFields = { ruta_transport: { value: 'x', confidence: 0.92, status: 'ok' } };
    expect(applyRouteConfidenceToField(okFields, { route: `${ORIGIN} / Sosea Viilor nr. 52, Bucuresti`, profileId: 'aviz_baumit_psl' }))
      .toEqual({ status: 'ok', reasons: [] });
    expect(okFields.ruta_transport).toEqual({ value: 'x', confidence: 0.92, status: 'ok' });

    const corrected = { ruta_transport: { value: 'x', confidence: 1, status: 'ok' } };
    expect(applyRouteConfidenceToField(corrected, { route: 'BOL', profileId: 'aviz_baumit_psl', corrected: true }).status).toBe('ok');
    expect(corrected.ruta_transport.status).toBe('ok');
  });

  it('route_trace carries the reason codes (no address text), and the event detail too', () => {
    const trace = buildRouteTrace({ context: 'extract', source: 'parser', confidence: { status: 'low', reasons: ['incomplete_leg'] } });
    expect(trace.confidence).toEqual({ status: 'low', reasons: ['incomplete_leg'] });
    expect(routeTraceEventDetail(trace).confidence_reasons).toEqual(['incomplete_leg']);
    expect(buildRouteTrace({ context: 'extract', source: 'parser' }).confidence).toBeUndefined();
  });
});

describe('B: parser does not over-reach (synthetic pages)', () => {
  it('a printed street type wins over company-looking words in the name', () => {
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Fabricii nr. 12\tStr. Aeroportului 120', 'Bucuresti Sector 6 RO 060251\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Str. Fabricii nr. 12, Bucuresti`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Calea Depozitelor nr. 3\tStr. Aeroportului 120', 'Ploiesti RO 100410\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Calea Depozitelor nr. 3, Ploiesti`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Constructorilor nr. 5\tStr. Aeroportului 120', 'Bucuresti Sector 6 RO 060512\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Str. Constructorilor nr. 5, Bucuresti`);
    expect(delivery(['HORNBACH DOMNESTI\tC23901527 HORNBACH ROMANIA SRL', 'Str. Hornbach, nr. 17-21\tStr. Aeroportului 120', 'Domnesti RO 077090\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Str. Hornbach nr. 17-21, Domnesti`);
  });

  it('a day-month street name keeps its digits; a plain name keeps the house number', () => {
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. 9 Mai nr. 10\tStr. Aeroportului 120', 'Ploiesti RO 100410\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Str. 9 Mai nr. 10, Ploiesti`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Bulevardul 1 Decembrie 1918 nr. 22\tStr. Aeroportului 120', 'Bucuresti Sector 3 RO 032451\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Bvd. 1 Decembrie 1918 nr. 22, Bucuresti`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Soseaua 13 Septembrie nr. 127\tStr. Aeroportului 120', 'Bucuresti Sector 5 RO 050712\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Șosea 13 Septembrie nr. 127, Bucuresti`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Mihai Viteazu nr. 13\tStr. Aeroportului 120', 'Ploiesti RO 100410\tBucuresti Sector 1 RO 013596']))
      .toBe(`${ORIGIN} / Str. Mihai Viteazu nr. 13, Ploiesti`);
  });

  it('an unreadable house number borrows nothing (not the 6 of Sector 6) and is not learned', () => {
    const raw = pslPage(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Bulevardul Iuliu Maniu nr. ~~\tStr. Aeroportului 120', 'Bucuresti Sector 6 RO 061129\tBucuresti Sector 1 RO 013596']);
    expect(parseBaumitAviz(raw).ruta_transport).toBe(`${ORIGIN} / Bvd. Iuliu Maniu, Bucuresti`);
    expect(parseDeliveryAddress(raw)).toMatchObject({ houseNumber: null, houseUnreadable: true });
    expect(deliveryObservationsFromOcr(raw)).toEqual([]);
  });

  it('village qualifiers join the town only without a comma', () => {
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Principala nr. 58 Bolintin Vale RO 087020\tStr. Aeroportului 120']))
      .toBe(`${ORIGIN} / Str. Principala nr. 58, Bolintin-Vale`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Morii nr. 4 Stefanesti de Jos RO 077175\tStr. Aeroportului 120']))
      .toBe(`${ORIGIN} / Str. Morii nr. 4, Stefanesti De Jos`);
    expect(delivery(['CLIENT TEST SRL\tC23901527 CLIENT TEST SRL', 'Str. Victoriei nr. 4 Baia Mare RO 430122\tStr. Aeroportului 120']))
      .toBe(`${ORIGIN} / Str. Victoriei nr. 4, Baia Mare`);
  });

  it('a branch line without any firm / chain word above a typeless street is not dropped blindly', () => {
    // Two name+number lines, neither a firm: the parser keeps the old reading (first one).
    const route = delivery(['MILITARI 2\tC23908171 CLIENT TEST', 'IULIU MANIU 536-560\tIULIU MANIU 536-560', 'Bucuresti Sector 6 RO 061344\tBucuresti Sector 6 RO 061344']);
    expect(route).toMatch(/^Str\. Republicii nr\. 1F, Bolintin-Deal \/ Str\. /);
  });
});
