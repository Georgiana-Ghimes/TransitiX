import { afterEach, describe, expect, it } from 'vitest';
import { parseRomanianAddress } from './address.js';
import {
  AUTO_ACCEPT_CONFIDENCE,
  photonErrorDetail,
  buildQueryText,
  buildSearchUrl,
  parseSearchResponse,
  photonConfigured,
  photonPing,
  rankCandidates,
  scoreCandidate,
  toCandidate,
} from './photon.js';

const originalUrl = process.env.PHOTON_URL;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.PHOTON_URL;
  else process.env.PHOTON_URL = originalUrl;
});

function feature(props, coordinates = [26.1025, 44.4268]) {
  return { geometry: { type: 'Point', coordinates }, properties: { countrycode: 'RO', ...props } };
}

describe('buildQueryText', () => {
  it('assembles street, city and postcode and pins the country', () => {
    const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');
    expect(buildQueryText(parsed)).toBe('str. Fabricii 12, cluj napoca, Romania');
  });

  it('falls back to the raw text when nothing parsed', () => {
    expect(buildQueryText(parseRomanianAddress('la km 7 pe centura')))
      .toContain('la km 7 pe centura');
  });
});

describe('buildSearchUrl', () => {
  it('constrains results to the Romanian bounding box', () => {
    const url = buildSearchUrl('http://photon:2322', parseRomanianAddress('Iași, str. Unirii 4'));
    expect(url).toContain('http://photon:2322/api?');
    expect(url).toContain('bbox=20.26%2C43.62%2C29.72%2C48.27');
    // 'ro' is NOT a supported Photon language — sending it 400s every request.
    expect(url).toContain('lang=default');
    expect(url).not.toContain('lang=ro');
  });

  it('refuses an empty address rather than querying for "Romania"', () => {
    expect(() => buildSearchUrl('http://photon:2322', parseRomanianAddress('')))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('toCandidate', () => {
  it('flips Photon lon,lat into the stored latitude/longitude order', () => {
    const candidate = toCandidate(feature({ name: 'X' }, [26.1025, 44.4268]));
    expect(candidate.latitude).toBe(44.4268);
    expect(candidate.longitude).toBe(26.1025);
  });

  it('returns null when the geometry is unusable', () => {
    expect(toCandidate({ properties: {} })).toBe(null);
    expect(toCandidate(null)).toBe(null);
  });
});

describe('scoreCandidate', () => {
  const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');

  it('scores an exact house-number match high enough to auto-accept', () => {
    const { score } = scoreCandidate(parsed, toCandidate(feature({
      housenumber: '12', street: 'Strada Fabricii', city: 'Cluj-Napoca', county: 'Cluj',
    })));
    expect(score).toBeGreaterThanOrEqual(AUTO_ACCEPT_CONFIDENCE);
  });

  it('keeps a street-level match below auto-accept', () => {
    const { score } = scoreCandidate(parsed, toCandidate(feature({
      street: 'Strada Fabricii', city: 'Cluj-Napoca',
    })));
    expect(score).toBeLessThan(AUTO_ACCEPT_CONFIDENCE);
    expect(score).toBeGreaterThan(0.4);
  });

  it('rejects anything outside Romania outright', () => {
    const result = scoreCandidate(parsed, toCandidate(feature({
      countrycode: 'HU', housenumber: '12', street: 'Fabricii', city: 'Cluj-Napoca',
    })));
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual(['alta_tara']);
  });

  it('penalises a result in the wrong city', () => {
    const right = scoreCandidate(parsed, toCandidate(feature({
      housenumber: '12', street: 'Strada Fabricii', city: 'Cluj-Napoca',
    })));
    const wrong = scoreCandidate(parsed, toCandidate(feature({
      housenumber: '12', street: 'Strada Fabricii', city: 'Iași',
    })));
    expect(wrong.score).toBeLessThan(right.score);
    expect(wrong.reasons).toContain('oras_diferit');
  });

  it('penalises a different house number on the right street', () => {
    const result = scoreCandidate(parsed, toCandidate(feature({
      housenumber: '98', street: 'Strada Fabricii', city: 'Cluj-Napoca',
    })));
    expect(result.reasons).toContain('numar_diferit');
    expect(result.score).toBeLessThan(AUTO_ACCEPT_CONFIDENCE);
  });

  it('notes when the requested number simply was not found', () => {
    const result = scoreCandidate(parsed, toCandidate(feature({
      street: 'Strada Fabricii', city: 'Cluj-Napoca',
    })));
    expect(result.reasons).toContain('numar_negasit');
  });

  it('does not accept a different street that shares its type word', () => {
    // Real miss from the first live run: "Calea Aradului 50, Timișoara" matched
    // "Calea Torontalului 50, Timișoara" at 1.00 because both contain "calea".
    const timisoara = parseRomanianAddress('Timișoara, Calea Aradului 50');
    const result = scoreCandidate(timisoara, toCandidate(feature({
      housenumber: '50', street: 'Calea Torontalului', city: 'Timișoara',
    })));
    expect(result.reasons).toContain('strada_diferita');
    expect(result.score).toBeLessThan(AUTO_ACCEPT_CONFIDENCE);
  });

  it('still matches the right street with the same type word', () => {
    const timisoara = parseRomanianAddress('Timișoara, Calea Aradului 50');
    const result = scoreCandidate(timisoara, toCandidate(feature({
      housenumber: '50', street: 'Calea Aradului', city: 'Timișoara',
    })));
    expect(result.reasons).toContain('strada_potrivita');
    expect(result.score).toBeGreaterThanOrEqual(AUTO_ACCEPT_CONFIDENCE);
  });

  it('tolerates inflected street names', () => {
    const parsedArad = parseRomanianAddress('Timișoara, Calea Arad 50');
    const result = scoreCandidate(parsedArad, toCandidate(feature({
      housenumber: '50', street: 'Calea Aradului', city: 'Timișoara',
    })));
    expect(result.reasons).toContain('strada_potrivita');
  });

  it('scores a bare locality low — a village centroid is not a delivery point', () => {
    const rural = parseRomanianAddress('Sat Cornu, com. Brebu, jud. Prahova');
    const result = scoreCandidate(rural, toCandidate(feature({
      name: 'Cornu', osm_key: 'place', osm_value: 'village', county: 'Prahova',
    })));
    expect(result.score).toBeLessThan(0.5);
  });

  it('never returns a score outside 0..1', () => {
    const result = scoreCandidate(parsed, toCandidate(feature({
      housenumber: '999', street: 'Complet Alta', city: 'Constanța',
    })));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('handles a null candidate', () => {
    expect(scoreCandidate(parsed, null)).toEqual({ score: 0, reasons: ['fara_rezultat'] });
  });
});

describe('rankCandidates', () => {
  it('sorts best first and drops unusable geometry', () => {
    const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');
    const ranked = rankCandidates(parsed, [
      feature({ street: 'Strada Fabricii', city: 'Cluj-Napoca' }),
      { properties: { countrycode: 'RO' } },
      feature({ housenumber: '12', street: 'Strada Fabricii', city: 'Cluj-Napoca' }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].housenumber).toBe('12');
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });
});

describe('parseSearchResponse', () => {
  const parsed = parseRomanianAddress('Cluj-Napoca, str. Fabricii 12');

  it('marks a strong result auto-acceptable', () => {
    const result = parseSearchResponse({
      features: [feature({ housenumber: '12', street: 'Strada Fabricii', city: 'Cluj-Napoca', county: 'Cluj' })],
    }, parsed);
    expect(result.autoAcceptable).toBe(true);
  });

  it('refuses to auto-accept a street-level guess', () => {
    const result = parseSearchResponse({
      features: [feature({ street: 'Strada Fabricii', city: 'Cluj-Napoca' })],
    }, parsed);
    expect(result.best).not.toBe(null);
    expect(result.autoAcceptable).toBe(false);
  });

  it('handles an empty result set', () => {
    expect(parseSearchResponse({ features: [] }, parsed))
      .toEqual({ candidates: [], best: null, autoAcceptable: false });
  });
});

describe('photonErrorDetail', () => {
  it('pulls the message out of a Photon validation error', () => {
    expect(photonErrorDetail({
      lang: [{ message: 'Language is not supported. Supported are: default, de, en, fr', value: 'ro' }],
    })).toMatch(/Language is not supported/);
  });

  it('prefers a top-level message', () => {
    expect(photonErrorDetail({ message: 'boom' })).toBe('boom');
  });

  it('returns null when there is nothing useful', () => {
    expect(photonErrorDetail(null)).toBe(null);
    expect(photonErrorDetail({ features: [] })).toBe(null);
  });
});

describe('configuration', () => {
  it('reports unconfigured when PHOTON_URL is blank', () => {
    process.env.PHOTON_URL = '  ';
    expect(photonConfigured()).toBe(false);
  });

  it('pings as unconfigured without touching the network', async () => {
    delete process.env.PHOTON_URL;
    expect(await photonPing()).toMatchObject({ configured: false, ok: false });
  });
});
