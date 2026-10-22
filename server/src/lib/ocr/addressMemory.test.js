import { describe, expect, it } from 'vitest';
import {
  addressMatchKey,
  addressTrustState,
  applyOriginMemory,
  expeditorStreetHints,
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
