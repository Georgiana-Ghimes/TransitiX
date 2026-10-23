import { describe, expect, it } from 'vitest';
import {
  applyAddressMemory,
  explainKnownAddressPick,
  pickKnownAddress,
} from './addressMemory.js';
import {
  applyLearnedRoute,
  buildRouteRuleFromOcr,
  learnedRouteConflictReason,
  preferLearnedRoute,
} from './routeLearn.js';
import { buildRouteTrace, routeSourceOf, routeTraceEventDetail } from './routeTrace.js';
import { routeWithCompanyMemory } from './routeDecorate.js';

// Same pages as addressMemory.test.js: Expeditor street garbled, postcode and town intact.
const GARBLED = [
  'Expeditor',
  'Site:\tBolintin',
  'Str.-.epuolicii, nr. IF Bolintin-Deal RO 087015 ROU',
  '\tPagina\t1/2',
  'Aviz de expeditie: PSL-0061424',
  'Adresa de livrare',
  '\tC23980798 !AP-ARABESQUE-LOHN LIVR,',
  'AP-ARABESQUE-LOHN LIVRA',
  '\tStr. Timisului, Nr.',
  'BULEVARDUL UNIRII NR 45, GAESTI, DAMBOVITA',
  '\tGalati RO 80000',
  'Gaesti RO 135200',
  'ROU',
  'Comanda de transport TPO-0035317',
].join('\n');

const DELIVERY_HEAD = [
  'Expeditor',
  'Site: BOI Bolintin',
  'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0061401',
  'Adresa de livrare\tClient',
  'GIULESTI BUILD SRL\tC23900001 GIULESTI BUILD SRL',
];
const DELIVERY_TAIL = [
  'Bucuresti Sector 6 RO 060251\tBucuresti Sector 6 RO 060251',
  'ROU\tROU',
  'Client factura:\tGIULESTI BUILD SRL',
  'Comanda de transport TPO-0035402',
];
const DELIVERY_CLEAN = [...DELIVERY_HEAD, 'Calea Giulesti, nr. 1-3\tCalea Giulesti, nr. 1-3', ...DELIVERY_TAIL].join('\n');
const DELIVERY_GARBLED = [...DELIVERY_HEAD, 'Ca1ea Giu1esti, nr. 1-3\tCa1ea Giu1esti, nr. 1-3', ...DELIVERY_TAIL].join('\n');

const REPUBLICII = {
  id: 'a1',
  postcode: '087015',
  locality: 'Bolintin-Deal',
  street_name: 'republicii',
  display: 'Str. Republicii nr. 1F, Bolintin-Deal',
  source: 'parsed',
  seen_count: 2,
  verified: false,
  disabled: false,
};
const INDUSTRIEI = { ...REPUBLICII, id: 'a2', street_name: 'industriei', display: 'Str. Industriei nr. 7, Bolintin-Deal' };
const GIULESTI = {
  id: 'd1',
  role: 'delivery',
  postcode: '060251',
  locality: 'Bucuresti',
  street_name: 'giulesti',
  display: 'Calea Giulesti nr. 1-3, Bucuresti',
  source: 'parsed',
  seen_count: 2,
  verified: false,
  disabled: false,
};

function originAttempt(trace) {
  return trace.find((a) => a.step === 'origin_memory');
}

describe('why a known address was not picked', () => {
  const at = { postcode: '087015', locality: 'Bolintin-Deal' };

  it('names every refusal', () => {
    expect(explainKnownAddressPick([REPUBLICII], { postcode: 'x' }).reason).toBe('no_postcode');
    expect(explainKnownAddressPick([REPUBLICII], { postcode: '087016' }).reason).toBe('unknown_postcode');
    expect(explainKnownAddressPick([{ ...REPUBLICII, seen_count: 1 }], at).reason).toBe('no_trusted');
    expect(explainKnownAddressPick([REPUBLICII], { ...at, locality: 'Ciorogarla' }).reason).toBe('locality_mismatch');
    const junk = { ...REPUBLICII, display: 'Str. Pantelimon Construct Srl nr. 5OS, Bolintin-Deal' };
    expect(explainKnownAddressPick([junk], at).reason).toBe('junk_filtered');
    expect(explainKnownAddressPick([REPUBLICII, INDUSTRIEI], { ...at, hints: ['zzzz'] })).toMatchObject({
      reason: 'below_threshold', candidates: 2,
    });
    const REPUBLICII_3 = { ...REPUBLICII, id: 'a3', display: 'Str. Republicii nr. 3, Bolintin-Deal' };
    expect(explainKnownAddressPick([REPUBLICII, REPUBLICII_3], { ...at, hints: ['epuolicii'] }).reason).toBe('ambiguous');
  });

  it('agrees with pickKnownAddress on every case', () => {
    const cases = [
      [[REPUBLICII], at],
      [[REPUBLICII], { postcode: '087016' }],
      [[{ ...REPUBLICII, seen_count: 1 }], at],
      [[REPUBLICII, INDUSTRIEI], { ...at, hints: ['epuolicii'] }],
      [[REPUBLICII, INDUSTRIEI], { ...at, hints: [] }],
      [[REPUBLICII, { ...INDUSTRIEI, source: 'corrected' }], at],
    ];
    for (const [list, opts] of cases) {
      expect(explainKnownAddressPick(list, opts).address).toBe(pickKnownAddress(list, opts));
    }
    expect(explainKnownAddressPick([REPUBLICII, INDUSTRIEI], { ...at, hints: ['epuolicii'] }))
      .toMatchObject({ address: REPUBLICII, reason: null, candidates: 2 });
  });
});

describe('address memory telemetry', () => {
  it('records the origin used, with its id', () => {
    const trace = [];
    const out = applyAddressMemory({}, GARBLED, [REPUBLICII], { trace });
    expect(out.address).toBe(REPUBLICII);
    expect(originAttempt(trace)).toMatchObject({ result: 'used', address_id: 'a1', origin_status: 'locality' });
  });

  it('records a refused origin with its reason', () => {
    const trace = [];
    applyAddressMemory({}, GARBLED, [REPUBLICII, INDUSTRIEI].map((a) => ({ ...a, street_name: 'zzz' })), { trace });
    expect(originAttempt(trace)).toMatchObject({ result: 'refused', reason: 'below_threshold' });
    const trace2 = [];
    applyAddressMemory({}, GARBLED, [{ ...REPUBLICII, seen_count: 1 }], { trace: trace2 });
    expect(originAttempt(trace2)).toMatchObject({ result: 'refused', reason: 'no_trusted' });
  });

  it('records a clean street as skipped, not refused', () => {
    const trace = [];
    applyAddressMemory({}, DELIVERY_CLEAN, [REPUBLICII, GIULESTI], { trace });
    expect(originAttempt(trace)).toEqual({ step: 'origin_memory', result: 'skipped', reason: 'street_read' });
    expect(trace.find((a) => a.step === 'delivery_memory'))
      .toEqual({ step: 'delivery_memory', stop: 0, result: 'skipped', reason: 'street_read' });
  });

  it('records each delivery stop', () => {
    const trace = [];
    const out = applyAddressMemory({}, DELIVERY_GARBLED, [REPUBLICII, GIULESTI], { trace });
    expect(out.deliveryAddresses).toEqual([GIULESTI]);
    expect(trace.find((a) => a.step === 'delivery_memory'))
      .toMatchObject({ stop: 0, result: 'used', address_id: 'd1' });
    const refused = [];
    applyAddressMemory({}, DELIVERY_GARBLED, [{ ...GIULESTI, seen_count: 1 }], { trace: refused });
    expect(refused.find((a) => a.step === 'delivery_memory'))
      .toMatchObject({ stop: 0, result: 'refused', reason: 'no_trusted' });
  });

  it('records the corrected_fields skip', () => {
    const trace = [];
    applyAddressMemory({ ruta_transport: 'x' }, GARBLED, [REPUBLICII], {
      correctedFields: ['ruta_transport'], trace,
    });
    expect(trace).toEqual([{ step: 'address_memory', result: 'skipped', reason: 'corrected_fields_skip' }]);
  });

  it('changes nothing about the result', () => {
    const lists = [[REPUBLICII], [REPUBLICII, GIULESTI], [{ ...REPUBLICII, seen_count: 1 }], []];
    for (const raw of [GARBLED, DELIVERY_CLEAN, DELIVERY_GARBLED, '']) {
      for (const list of lists) {
        const plain = applyAddressMemory({ ruta_transport: 'r' }, raw, list);
        const traced = applyAddressMemory({ ruta_transport: 'r' }, raw, list, { trace: [] });
        expect(traced).toEqual(plain);
      }
    }
  });

  it('never carries address text or postcodes', () => {
    const trace = [];
    applyAddressMemory({}, DELIVERY_GARBLED.replace('Str. Republicii, nr. 1F', 'Str.-.epuolicii, nr. IF'),
      [REPUBLICII, GIULESTI], { trace });
    const json = JSON.stringify(trace);
    for (const piece of ['087015', '060251', 'Republicii', 'Giulesti', 'Bolintin', 'Bucuresti']) {
      expect(json).not.toContain(piece);
    }
  });
});

describe('learned rule telemetry', () => {
  const page = (street) => [
    'Expeditor',
    'Site: BOI Bolintin',
    'Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU',
    'Aviz de expeditie: PSL-0072722',
    'Adresa de livrare\tClient',
    'DOROBANTI RESIDENCE SRL\tC23902722 DOROBANTI RESIDENCE SRL',
    `${street}\t${street}`,
    'Bucuresti Sector 1 RO 010565\tBucuresti Sector 1 RO 010565',
    'Client factura:\tDOROBANTI RESIDENCE SRL',
    'Comanda de transport TPO-0037722',
  ].join('\n');
  const CLEAR = page('Calea Dorobantilor, nr. 135');
  const built = buildRouteRuleFromOcr(CLEAR);
  const rule = {
    id: 'r1',
    match_regex: built.matchRegex,
    match_tokens: built.tokens,
    ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Dorobantilor nr. 135A, Bucuresti',
  };
  const STRUCT = 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Dorobantilor nr. 135, Bucuresti';

  it('names the conflict', () => {
    expect(learnedRouteConflictReason(CLEAR, rule.ruta_transport)).toBe('conflict_house');
    expect(learnedRouteConflictReason(CLEAR, 'X / Bvd. Iancu de Hunedoara nr. 30, Bucuresti')).toBe('conflict_street');
    expect(learnedRouteConflictReason(page('Calea Dorobantilor, nr. 135A'), rule.ruta_transport)).toBeNull();
  });

  it('records refusals and uses', () => {
    const trace = [];
    applyLearnedRoute({ ruta_transport: STRUCT }, CLEAR, [rule], { trace });
    expect(trace).toEqual([{ step: 'route_rule', result: 'refused', reason: 'conflict_house', rule_id: 'r1' }]);

    const used = [];
    const ruleSame = { ...rule, id: 'r2', ruta_transport: STRUCT };
    const applied = applyLearnedRoute({}, CLEAR, [ruleSame], { trace: used });
    expect(applied.learned).toBe(true);
    expect(used).toEqual([{ step: 'route_rule', result: 'used', rule_id: 'r2' }]);

    const none = [];
    applyLearnedRoute({}, GARBLED, [rule], { trace: none });
    expect(none).toEqual([{ step: 'route_rule', result: 'skipped', reason: 'no_match', rules: 1 }]);

    const pinned = [];
    preferLearnedRoute(STRUCT, CLEAR, [rule], { corrected: true, trace: pinned });
    expect(pinned[0]).toMatchObject({ reason: 'corrected_fields_skip' });

    const same = [];
    preferLearnedRoute(STRUCT, CLEAR, [ruleSame], { trace: same });
    expect(same).toEqual([{ step: 'route_rule', result: 'used', rule_id: 'r2', same_as_stored: true }]);
  });

  it('changes nothing about the result', () => {
    for (const raw of [CLEAR, page('Calea Dorobantilor, nr. 135A'), GARBLED]) {
      expect(applyLearnedRoute({ ruta_transport: STRUCT }, raw, [rule], { trace: [] }))
        .toEqual(applyLearnedRoute({ ruta_transport: STRUCT }, raw, [rule]));
      expect(preferLearnedRoute(STRUCT, raw, [rule], { trace: [] }))
        .toEqual(preferLearnedRoute(STRUCT, raw, [rule]));
    }
  });
});

describe('the trace object', () => {
  it('summarises the source and counts refusals', () => {
    const trace = buildRouteTrace({
      context: 'extract',
      source: 'parser',
      attempts: [
        { step: 'origin_memory', result: 'refused', reason: 'ambiguous' },
        { step: 'delivery_memory', stop: 0, result: 'refused', reason: 'no_trusted' },
        { step: 'delivery_memory', stop: 1, result: 'refused', reason: 'no_trusted' },
        { step: 'route_rule', result: 'skipped', reason: 'no_match' },
      ],
    });
    expect(trace).toMatchObject({
      v: 1, context: 'extract', source: 'parser', rule_id: null, origin_address_id: null,
      refused: { ambiguous: 1, no_trusted: 2 },
    });
    expect(routeTraceEventDetail(trace)).toEqual({ source: 'parser', refused: { ambiguous: 1, no_trusted: 2 } });
  });

  it('says when a rule replaced a memory fill', () => {
    const trace = buildRouteTrace({
      context: 'extract', source: 'rule', rule: { id: 'r1' }, originAddress: REPUBLICII, attempts: [],
    });
    expect(trace).toMatchObject({ rule_id: 'r1', origin_address_id: null, memory_overridden_by_rule: true });
  });

  it('picks the source in priority order', () => {
    expect(routeSourceOf({ corrected: true, ruleUsed: true })).toBe('corrected');
    expect(routeSourceOf({ ruleUsed: true, memoryUsed: true })).toBe('rule');
    expect(routeSourceOf({ memoryUsed: true })).toBe('memory');
    expect(routeSourceOf({ route: 'A / B' })).toBe('parser');
    expect(routeSourceOf({ route: '  ' })).toBe('none');
  });
});

describe('decorate telemetry', () => {
  const row = (over = {}) => ({
    id: 'doc1',
    ocr_profile_id: 'aviz_baumit',
    ruta_transport: 'Bolintin-Deal / Bvd. Unirii nr. 45, Gaesti',
    corrected_fields: [],
    extracted_data: { raw_text: GARBLED, route_trace: { context: 'extract' } },
    ...over,
  });

  it('puts the read-time trace next to the extract one', () => {
    const out = routeWithCompanyMemory(row(), { knownAddresses: [REPUBLICII] });
    expect(out.ruta).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bvd. Unirii nr. 45, Gaesti');
    expect(out.extracted_data.route_trace).toEqual({ context: 'extract' });
    expect(out.extracted_data.route_trace_view).toMatchObject({
      context: 'decorate', source: 'memory', origin_address_id: 'a1',
    });
  });

  it('records a pinned route as corrected and leaves it', () => {
    const out = routeWithCompanyMemory(row({ corrected_fields: ['ruta_transport'], ruta_transport: 'typed' }), {
      knownAddresses: [REPUBLICII],
    });
    expect(out.ruta).toBe('typed');
    expect(out.trace.source).toBe('corrected');
  });

  it('leaves a row without extracted_data as it was', () => {
    const out = routeWithCompanyMemory(row({ extracted_data: null }), { knownAddresses: [REPUBLICII] });
    expect(out.extracted_data).toBeNull();
    expect(out.trace.source).toBe('parser');
  });
});
