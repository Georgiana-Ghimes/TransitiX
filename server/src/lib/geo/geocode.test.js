import { describe, expect, it } from 'vitest';
import {
  applyToLocation,
  decideOutcome,
  emptyStats,
  fromCacheRow,
  geocodeAddress,
  tally,
} from './geocode.js';

/** Minimal db double: records every query and replays queued rows. */
function fakeDb(rowsQueue = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.trim().split('\n')[0], params });
      return { rows: rowsQueue.shift() || [], rowCount: 0 };
    },
  };
}

const CLUJ = 'Cluj-Napoca, str. Fabricii 12';

function searchReturning(best, candidates = []) {
  return async () => ({ best, candidates: candidates.length ? candidates : (best ? [best] : []) });
}

describe('decideOutcome', () => {
  it('auto-accepts a high-confidence pin', () => {
    expect(decideOutcome({ confidence: 0.9 })).toMatchObject({ action: 'accept' });
    expect(decideOutcome({ confidence: 0.8 })).toMatchObject({ action: 'accept' });
  });

  it('sends a middling pin to review rather than trusting it', () => {
    expect(decideOutcome({ confidence: 0.79 })).toMatchObject({ action: 'review' });
    expect(decideOutcome({ confidence: 0.45 })).toMatchObject({ action: 'review' });
  });

  it('rejects a weak pin outright', () => {
    expect(decideOutcome({ confidence: 0.44 })).toMatchObject({ action: 'reject' });
    expect(decideOutcome(null)).toMatchObject({ action: 'reject', reason: 'niciun_rezultat' });
  });

  it('honours a custom auto-accept threshold', () => {
    expect(decideOutcome({ confidence: 0.7 }, { autoAccept: 0.6 })).toMatchObject({ action: 'accept' });
  });
});

describe('fromCacheRow', () => {
  it('rebuilds a hit with numeric coordinates', () => {
    const result = fromCacheRow({
      status: 'hit', latitude: '46.7712', longitude: '23.6236',
      confidence: '0.90', matched_label: 'Fabricii 12', candidates: [],
    });
    expect(result.best).toEqual({
      latitude: 46.7712, longitude: 23.6236, confidence: 0.9, label: 'Fabricii 12',
    });
  });

  it('returns no pin for a cached miss', () => {
    expect(fromCacheRow({ status: 'miss', candidates: [] }).best).toBe(null);
  });

  it('passes through a cached error message', () => {
    expect(fromCacheRow({ status: 'error', error_message: 'timeout' }).error).toBe('timeout');
  });

  it('handles a missing row', () => {
    expect(fromCacheRow(null)).toBe(null);
  });
});

describe('geocodeAddress', () => {
  it('rejects an address that produces no key, without calling the provider', async () => {
    let called = false;
    const result = await geocodeAddress(fakeDb(), 'co', '', {
      search: async () => { called = true; return { best: null, candidates: [] }; },
    });
    expect(called).toBe(false);
    expect(result.outcome).toMatchObject({ action: 'reject', reason: 'adresa_invalida' });
  });

  it('serves a cached hit without calling the provider', async () => {
    const db = fakeDb([[{
      status: 'hit', latitude: '46.7712', longitude: '23.6236',
      confidence: '0.90', matched_label: 'Fabricii 12', candidates: [],
    }]]);
    let called = false;
    const result = await geocodeAddress(db, 'co', CLUJ, {
      search: async () => { called = true; return { best: null, candidates: [] }; },
    });
    expect(called).toBe(false);
    expect(result.cached).toBe(true);
    expect(result.outcome.action).toBe('accept');
  });

  it('re-queries when refresh is requested', async () => {
    const db = fakeDb([[{ status: 'hit', latitude: '1', longitude: '2', confidence: '0.9', candidates: [] }]]);
    let called = false;
    await geocodeAddress(db, 'co', CLUJ, {
      refresh: true,
      search: async () => { called = true; return { best: null, candidates: [] }; },
    });
    expect(called).toBe(true);
  });

  it('writes a hit to the cache', async () => {
    const db = fakeDb();
    const best = { latitude: 46.77, longitude: 23.62, confidence: 0.92, label: 'Fabricii 12' };
    const result = await geocodeAddress(db, 'co', CLUJ, { search: searchReturning(best) });
    expect(result.outcome.action).toBe('accept');
    const insert = db.calls.find((c) => c.text.startsWith('INSERT INTO geocode_cache'));
    expect(insert).toBeTruthy();
    expect(insert.params).toContain('hit');
  });

  it('caches a miss so the provider is not asked again', async () => {
    const db = fakeDb();
    const result = await geocodeAddress(db, 'co', CLUJ, { search: searchReturning(null) });
    expect(result.outcome.action).toBe('reject');
    const insert = db.calls.find((c) => c.text.startsWith('INSERT INTO geocode_cache'));
    expect(insert.params).toContain('miss');
  });

  it('caches a provider failure instead of letting it throw', async () => {
    const db = fakeDb();
    const result = await geocodeAddress(db, 'co', CLUJ, {
      search: async () => { throw new Error('Photon inaccesibil'); },
    });
    expect(result.error).toBe('Photon inaccesibil');
    expect(result.outcome).toMatchObject({ action: 'reject', reason: 'eroare_provider' });
    const insert = db.calls.find((c) => c.text.startsWith('INSERT INTO geocode_cache'));
    expect(insert.params).toContain('error');
  });

  it('does not retry an address that previously errored', async () => {
    const db = fakeDb([[{ status: 'error', error_message: 'timeout', candidates: [] }]]);
    let called = false;
    const result = await geocodeAddress(db, 'co', CLUJ, {
      search: async () => { called = true; return { best: null, candidates: [] }; },
    });
    expect(called).toBe(false);
    expect(result.outcome.reason).toBe('eroare_anterioara');
  });
});

describe('applyToLocation', () => {
  it('writes coordinates but never marks the location verified', async () => {
    const db = fakeDb();
    const written = await applyToLocation(db, 'co', 'loc1', {
      best: { latitude: 46.77, longitude: 23.62, confidence: 0.92 },
      outcome: { action: 'accept' },
    });
    expect(written).toBe(true);
    const update = db.calls.find((c) => c.text.startsWith('UPDATE locations'));
    expect(update.text).not.toContain('geocode_verified');
    expect(update.params).toEqual([46.77, 23.62, 0.92, 'photon', 'loc1', 'co']);
  });

  it('still writes coordinates for a review-tier result', async () => {
    const db = fakeDb();
    const written = await applyToLocation(db, 'co', 'loc1', {
      best: { latitude: 1, longitude: 2, confidence: 0.5 },
      outcome: { action: 'review' },
    });
    expect(written).toBe(true);
  });

  it('writes nothing for a rejected result', async () => {
    const db = fakeDb();
    expect(await applyToLocation(db, 'co', 'loc1', { best: null, outcome: { action: 'reject' } })).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});

describe('tally', () => {
  it('counts each outcome and cache hits separately', () => {
    const stats = emptyStats();
    tally(stats, { cached: false, outcome: { action: 'accept' } });
    tally(stats, { cached: true, outcome: { action: 'review' } });
    tally(stats, { cached: false, outcome: { action: 'reject' }, error: 'boom' });
    expect(stats).toEqual({ total: 3, accepted: 1, review: 1, rejected: 1, cached: 1, errors: 1 });
  });
});
