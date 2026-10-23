import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The same aviz must carry the same route in the /avize list, the /avize annex export and
 * /reports. The three read the same rows through one database stub here, so the only thing that
 * can make them differ is the decoration itself.
 */

const db = vi.hoisted(() => ({ rows: [], rules: [], addresses: [] }));

vi.mock('../db.js', () => {
  const query = async (sql) => {
    const text = String(sql);
    if (text.includes('FROM aviz_route_rules')) return { rows: db.rules, rowCount: db.rules.length };
    if (text.includes('FROM aviz_known_addresses')) return { rows: db.addresses, rowCount: db.addresses.length };
    if (text.includes('FROM aviz_documents')) return { rows: db.rows, rowCount: db.rows.length };
    return { rows: [], rowCount: 0 };
  };
  return {
    query,
    pool: { query },
    withTransaction: async (fn) => fn({ query }),
  };
});

const { decorateAviz, loadAvizeByIds } = await import('./avize.js');
const { selectDocuments } = await import('./reports.js');
const { buildRouteRuleFromOcr } = await import('../lib/ocr/routeLearn.js');

const COMPANY = '00000000-0000-0000-0000-000000000001';

// Expeditor street lost to the scanner; postcode and town survived (#112).
const GARBLED_ORIGIN = [
  'Expeditor',
  'Site:\tBolintin',
  'Str.-.epuolicii, nr. IF Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0061424',
  'Adresa de livrare\tClient',
  'GIULESTI BUILD SRL\tC23900001 GIULESTI BUILD SRL',
  'Calea Giulesti, nr. 1-3\tCalea Giulesti, nr. 1-3',
  'Bucuresti Sector 6 RO 060251\tBucuresti Sector 6 RO 060251',
  'Client factura:\tGIULESTI BUILD SRL',
  'Comanda de transport TPO-0035317',
].join('\n');

// Delivery street lost, Expeditor fine.
const GARBLED_DELIVERY = [
  'Expeditor',
  'Site: BOI Bolintin',
  'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0061401',
  'Adresa de livrare\tClient',
  'GIULESTI BUILD SRL\tC23900001 GIULESTI BUILD SRL',
  'Ca1ea Giu1esti, nr. 1-3\tCa1ea Giu1esti, nr. 1-3',
  'Bucuresti Sector 6 RO 060251\tBucuresti Sector 6 RO 060251',
  'Client factura:\tGIULESTI BUILD SRL',
  'Comanda de transport TPO-0035402',
].join('\n');

// A page an office correction taught a whole-route rule for.
const RULE_PAGE = [
  'Expeditor',
  'Site: BOI Bolintin',
  'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0072722',
  'Adresa de livrare\tClient',
  'PANTELIMON CONSTRUCT SRL\tC23902722 PANTELIMON CONSTRUCT SRL',
  '5os. Pante1imon, nr. 244\t5os. Pante1imon, nr. 244',
  'Bucuresti Sector 2 RO 021586\tBucuresti Sector 2 RO 021586',
  'Comanda de transport TPO-0037722',
].join('\n');

const REPUBLICII = {
  id: 'a1', role: 'origin', postcode: '087015', locality: 'Bolintin-Deal', street_name: 'republicii',
  display: 'Str. Republicii nr. 1F, Bolintin-Deal', source: 'parsed', seen_count: 3, verified: false, disabled: false,
};
const GIULESTI = {
  id: 'd1', role: 'delivery', postcode: '060251', locality: 'Bucuresti', street_name: 'giulesti',
  display: 'Calea Giulesti nr. 1-3, Bucuresti', source: 'parsed', seen_count: 2, verified: false, disabled: false,
};

function doc(id, raw, over = {}) {
  return {
    id,
    company_id: COMPANY,
    document_type: 'aviz',
    status: 'extracted',
    ocr_profile_id: 'aviz_baumit',
    ruta_transport: null,
    corrected_fields: [],
    numar_auto: 'B 47 RAI',
    extracted_data: { raw_text: raw, values: {} },
    created_at: new Date('2026-10-21T08:00:00Z'),
    updated_at: new Date('2026-10-21T08:00:00Z'),
    ...over,
  };
}

async function routesEverywhere() {
  const ids = db.rows.map((r) => r.id);
  const list = Object.fromEntries(db.rows.map((row) => [
    row.id,
    decorateAviz(row, { routeRules: db.rules, knownAddresses: db.addresses }).ruta_transport,
  ]));
  const annex = Object.fromEntries((await loadAvizeByIds(COMPANY, ids)).map((d) => [d.id, d.ruta_transport]));
  const { documents } = await selectDocuments(COMPANY, { aviz_ids: ids });
  const report = Object.fromEntries(documents.map((d) => [d.id, d.ruta_transport]));
  return { list, annex, report };
}

describe('/avize and /reports show the same route', () => {
  beforeEach(() => {
    const built = buildRouteRuleFromOcr(RULE_PAGE);
    db.rules = [{
      id: 'r1',
      match_regex: built.matchRegex,
      match_tokens: built.tokens,
      ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal / Șosea Pantelimon nr. 244, Bucuresti',
      updated_at: '2026-10-20T00:00:00Z',
    }];
    db.addresses = [REPUBLICII, GIULESTI];
    db.rows = [
      doc('origin-memory', GARBLED_ORIGIN),
      doc('delivery-memory', GARBLED_DELIVERY),
      doc('rule', RULE_PAGE),
      doc('pinned', GARBLED_ORIGIN, {
        ruta_transport: 'Ce a scris biroul / Bucuresti',
        corrected_fields: ['ruta_transport'],
      }),
      doc('manual', null, { extracted_data: null, ruta_transport: 'A / B' }),
    ];
  });

  it('agrees on every row: list, annex export and report', async () => {
    const { list, annex, report } = await routesEverywhere();
    expect(annex).toEqual(list);
    expect(report).toEqual(list);
    // And each is the route it should be, so agreement is not agreement on nothing.
    expect(list['origin-memory']).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti');
    expect(list['delivery-memory']).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti');
    expect(list.rule).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Pantelimon nr. 244, Bucuresti');
    expect(list.pinned).toBe('Ce a scris biroul / Bucuresti');
    expect(list.manual).toBe('A / B');
  });

  it('agrees on the provenance flags and the read-time trace too', async () => {
    const ids = db.rows.map((r) => r.id);
    const { documents } = await selectDocuments(COMPANY, { aviz_ids: ids });
    const annex = await loadAvizeByIds(COMPANY, ids);
    for (const row of db.rows) {
      const fromList = decorateAviz(row, { routeRules: db.rules, knownAddresses: db.addresses }).extracted_data;
      const fromReport = documents.find((d) => d.id === row.id).extracted_data;
      const fromAnnex = annex.find((d) => d.id === row.id).extracted_data;
      for (const other of [fromReport, fromAnnex]) {
        expect(other?.origin_source ?? null).toBe(fromList?.origin_source ?? null);
        expect(other?.delivery_source ?? null).toBe(fromList?.delivery_source ?? null);
        expect(other?.route_source ?? null).toBe(fromList?.route_source ?? null);
        expect(other?.route_trace_view?.source ?? null).toBe(fromList?.route_trace_view?.source ?? null);
      }
    }
    const byId = Object.fromEntries(documents.map((d) => [d.id, d.extracted_data?.route_trace_view?.source]));
    expect(byId).toEqual({
      'origin-memory': 'memory',
      'delivery-memory': 'memory',
      rule: 'rule',
      pinned: 'corrected',
      manual: undefined,
    });
  });

  it('flags the memory route as low on the list (unchanged /avize behaviour)', () => {
    const decorated = decorateAviz(db.rows[0], { routeRules: db.rules, knownAddresses: db.addresses });
    expect(decorated.field_confidence.ruta_transport).toBe('low');
    expect(decorated.extracted_data.origin_address_id).toBe('a1');
  });
});
