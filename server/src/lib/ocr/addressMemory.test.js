import { describe, expect, it } from 'vitest';
import {
  addressMatchKey,
  addressTrustState,
  applyAddressMemory,
  applyOriginMemory,
  deliveryObservationsFromCorrection,
  deliveryObservationsFromOcr,
  expeditorStreetHints,
  fillDeliveryFromMemory,
  fillOriginFromMemory,
  isTrustedAddress,
  normalizePostcode,
  originObservationFromCorrection,
  originObservationFromOcr,
  pickKnownAddress,
  similarity,
} from './addressMemory.js';
import { parseBaumitAviz } from '../avizOcr.js';

// Scanner text layer of PSL-0061424 (#112): street mangled, town + postcode intact,
// Client column interleaved as right-only rows.
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

// Same depot, read cleanly on another aviz.
const CLEAN = [
  'Expeditor',
  'Site: BOL Bolintin',
  'Str. Republicii nr. 1F Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0058443',
  'Adresa de livrare\tClient',
  'HORNBACH CENTRALA SRL BALOTESTI\tC23934520 HORNBACH CENTRALA SRL BALOTESTI',
  'Calea Bucuresti, nr. 2A\tCalea Bucuresti, nr. 2A',
  'Balotesti RO 077015\tBalotesti RO 077015',
  'Comanda de transport TPO-0033000',
].join('\n');

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

describe('trust', () => {
  it('needs two clean reads, a person, or a confirmation', () => {
    expect(isTrustedAddress({ ...REPUBLICII, seen_count: 1 })).toBe(false);
    expect(isTrustedAddress({ ...REPUBLICII, seen_count: 2 })).toBe(true);
    expect(isTrustedAddress({ ...REPUBLICII, seen_count: 0, source: 'corrected' })).toBe(true);
    expect(isTrustedAddress({ ...REPUBLICII, seen_count: 0, verified: true })).toBe(true);
  });

  it('never trusts a disabled address', () => {
    expect(isTrustedAddress({ ...REPUBLICII, disabled: true, verified: true })).toBe(false);
    expect(addressTrustState({ ...REPUBLICII, disabled: true })).toBe('disabled');
    expect(addressTrustState({ ...REPUBLICII, seen_count: 1 })).toBe('candidate');
  });
});

describe('helpers', () => {
  it('pads a postcode that lost its leading zero', () => {
    expect(normalizePostcode('87015')).toBe('087015');
    expect(normalizePostcode('RO 087015')).toBe('087015');
    expect(normalizePostcode('1234')).toBeNull();
  });

  it('dedupes legs that differ only in punctuation and diacritics', () => {
    expect(addressMatchKey('Str. Republicii nr. 1F, Bolintin-Deal'))
      .toBe(addressMatchKey('str republicii NR 1F  Bolintin Deal'));
  });

  it('sees the garbled street as close to the real one', () => {
    expect(similarity('republicii', 'epuolicii')).toBeGreaterThanOrEqual(0.6);
    expect(similarity('republicii', 'timisului')).toBeLessThan(0.4);
  });

  it('keeps street leftovers and drops town words from the Expeditor block', () => {
    const hints = expeditorStreetHints(GARBLED, 'bolintin-deal');
    expect(hints).toContain('epuolicii');
    expect(hints).not.toContain('bolintin');
    expect(hints).not.toContain('timisului');
  });
});

describe('learning what to remember', () => {
  it('remembers a clean Expeditor read with its postcode', () => {
    expect(originObservationFromOcr(CLEAN)).toMatchObject({
      postcode: '087015',
      display: 'Str. Republicii nr. 1F, Bolintin-Deal',
    });
  });

  it('remembers nothing from an unreadable street', () => {
    expect(originObservationFromOcr(GARBLED)).toBeNull();
  });

  it('takes the origin leg from an office correction, tied to the page postcode', () => {
    const obs = originObservationFromCorrection(
      GARBLED,
      'Str. Republicii nr. 1F, Bolintin-Deal / Bvd. Unirii nr. 45, Gaesti',
    );
    expect(obs).toMatchObject({
      postcode: '087015',
      locality: 'Bolintin-Deal',
      street_name: 'republicii',
      display: 'Str. Republicii nr. 1F, Bolintin-Deal',
    });
  });

  it('ignores corrections that are not a street leg or name another town', () => {
    expect(originObservationFromCorrection(GARBLED, 'MIL-NEAMTIU / Bvd. Unirii nr. 45, Gaesti')).toBeNull();
    expect(originObservationFromCorrection(GARBLED, 'Bvd. Unirii nr. 45, Gaesti')).toBeNull();
    expect(originObservationFromCorrection(GARBLED, 'Str. Industriei nr. 7, Ploiesti / Bvd. Unirii nr. 45, Gaesti')).toBeNull();
  });
});

describe('picking a known address', () => {
  it('takes the only trusted address on the postcode', () => {
    expect(pickKnownAddress([REPUBLICII], { postcode: '087015', locality: 'bolintin-deal' })).toBe(REPUBLICII);
  });

  it('ignores candidates, other postcodes and other towns', () => {
    expect(pickKnownAddress([{ ...REPUBLICII, seen_count: 1 }], { postcode: '087015' })).toBeNull();
    expect(pickKnownAddress([REPUBLICII], { postcode: '087016' })).toBeNull();
    expect(pickKnownAddress([REPUBLICII], { postcode: '087015', locality: 'Ciorogarla' })).toBeNull();
  });

  it('uses the garbled street to choose between two depots on one postcode', () => {
    const other = { ...REPUBLICII, id: 'a2', street_name: 'industriei', display: 'Str. Industriei nr. 7, Bolintin-Deal' };
    expect(pickKnownAddress([other, REPUBLICII], { postcode: '087015', hints: ['epuolicii'] })).toBe(REPUBLICII);
    expect(pickKnownAddress([other, REPUBLICII], { postcode: '087015', hints: [] })).toBeNull();
  });

  it('prefers what a person confirmed over what was only parsed', () => {
    const parsedWrong = { ...REPUBLICII, id: 'p', display: 'Str. Republicii nr. 17, Bolintin-Deal', seen_count: 9 };
    const corrected = { ...REPUBLICII, id: 'c', source: 'corrected', seen_count: 0 };
    expect(pickKnownAddress([parsedWrong, corrected], { postcode: '087015' })).toBe(corrected);
  });
});

describe('filling the route', () => {
  it('without memory the route keeps the town as origin (#112)', () => {
    expect(parseBaumitAviz(GARBLED).ruta_transport).toBe('Bolintin-Deal / Bvd. Unirii nr. 45, Gaesti');
  });

  it('fills the unreadable street from a trusted address', () => {
    const filled = fillOriginFromMemory(GARBLED, [REPUBLICII]);
    expect(filled.route).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bvd. Unirii nr. 45, Gaesti');
    expect(filled.address).toBe(REPUBLICII);
  });

  it('never replaces a street the page printed clearly', () => {
    expect(fillOriginFromMemory(CLEAN, [{ ...REPUBLICII, display: 'Str. Alta nr. 1, Bolintin-Deal' }])).toBeNull();
  });

  it('leaves a route the office pinned', () => {
    const { values, address } = applyOriginMemory(
      { ruta_transport: 'ce a scris biroul' },
      GARBLED,
      [REPUBLICII],
      { correctedFields: ['ruta_transport'] },
    );
    expect(values.ruta_transport).toBe('ce a scris biroul');
    expect(address).toBeNull();
  });
});

// Delivery block whose street the text layer lost (`Ca1ea Giu1esti`), postcode intact.
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

describe('delivery addresses', () => {
  it('learns a clean delivery stop, with its postcode', () => {
    expect(deliveryObservationsFromOcr(DELIVERY_CLEAN)).toEqual([{
      postcode: '060251',
      locality: 'Bucuresti',
      street_name: 'giulesti',
      display: 'Calea Giulesti nr. 1-3, Bucuresti',
      match_key: addressMatchKey('Calea Giulesti nr. 1-3, Bucuresti'),
    }]);
  });

  it('learns nothing from a stop whose street did not read', () => {
    expect(deliveryObservationsFromOcr(DELIVERY_GARBLED)).toEqual([]);
  });

  it('without memory the garbled stop is only the town', () => {
    expect(parseBaumitAviz(DELIVERY_GARBLED).ruta_transport)
      .toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bucuresti');
  });

  it('fills the unreadable delivery street from a trusted address on that postcode', () => {
    const { values, address, deliveryAddresses } = applyAddressMemory(
      { ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal / Bucuresti' },
      DELIVERY_GARBLED,
      [REPUBLICII, GIULESTI],
    );
    expect(values.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti');
    // The Expeditor street read fine: the origin memory stays out of it.
    expect(address).toBeNull();
    expect(deliveryAddresses).toEqual([GIULESTI]);
  });

  it('fills origin and delivery together when both lost their street', () => {
    const both = DELIVERY_GARBLED.replace('Str. Republicii, nr. 1F', 'Str.-.epuolicii, nr. IF');
    const { values, address, deliveryAddresses } = applyAddressMemory({}, both, [REPUBLICII, GIULESTI]);
    expect(values.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti');
    expect(address).toBe(REPUBLICII);
    expect(deliveryAddresses).toEqual([GIULESTI]);
  });

  it('does not use a candidate, a disabled address or an origin for a delivery stop', () => {
    expect(fillDeliveryFromMemory(DELIVERY_GARBLED, [{ ...GIULESTI, seen_count: 1 }])).toBeNull();
    expect(fillDeliveryFromMemory(DELIVERY_GARBLED, [{ ...GIULESTI, disabled: true }])).toBeNull();
    expect(fillDeliveryFromMemory(DELIVERY_GARBLED, [{ ...GIULESTI, role: 'origin' }])).toBeNull();
  });

  it('never replaces a delivery street the page printed clearly', () => {
    expect(fillDeliveryFromMemory(DELIVERY_CLEAN, [{ ...GIULESTI, display: 'Str. Alta nr. 9, Bucuresti' }])).toBeNull();
  });

  it('keeps origin-only callers away from delivery memory', () => {
    const { values, address } = applyOriginMemory({ ruta_transport: 'x' }, DELIVERY_GARBLED, [GIULESTI]);
    expect(values.ruta_transport).toBe('x');
    expect(address).toBeNull();
  });

  it('learns the delivery legs an operator typed, tied to the printed postcode', () => {
    const typed = 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti';
    expect(deliveryObservationsFromCorrection(DELIVERY_GARBLED, typed)).toEqual([{
      postcode: '060251',
      locality: 'Bucuresti',
      street_name: 'giulesti',
      display: 'Calea Giulesti nr. 1-3, Bucuresti',
      match_key: addressMatchKey('Calea Giulesti nr. 1-3, Bucuresti'),
    }]);
    // Town that disagrees with the page, or more legs than printed stops: learn nothing.
    expect(deliveryObservationsFromCorrection(DELIVERY_GARBLED, 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Ploiesti')).toEqual([]);
    expect(deliveryObservationsFromCorrection(DELIVERY_GARBLED, `${typed} / Str. Alta nr. 2, Bucuresti`)).toEqual([]);
  });
});

describe('typed legs', () => {
  it('splits a typed leg into street and town', async () => {
    const { splitAddressLeg, looksLikeStreetLeg } = await import('./addressMemory.js');
    expect(splitAddressLeg('Str. Republicii nr. 1F, Bolintin-Deal')).toEqual({
      street_name: 'republicii', locality: 'Bolintin-Deal',
    });
    expect(splitAddressLeg('Bvd. Iuliu Maniu nr. 600A, Bucuresti').street_name).toBe('iuliu maniu');
    expect(looksLikeStreetLeg('MIL-NEAMTIU')).toBe(false);
    expect(looksLikeStreetLeg('Calea Bucuresti nr. 2A, Balotesti')).toBe(true);
  });
});
