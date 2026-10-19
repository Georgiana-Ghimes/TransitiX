import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WHATS_NEW_KEEP,
  WHATS_NEW_SEEN_BUILD_KEY,
  WHATS_NEW_SEEN_KEY,
  WHATS_NEW_RELEASES,
  effectiveSeenBuild,
  fetchWhatsNewClientIp,
  getSeenWhatsNew,
  getSeenWhatsNewBuild,
  keepNewestWhatsNewReleases,
  markWhatsNewSeen,
  normalizeIp,
  parseBuild,
  releasesForModal,
  shouldAutoOpenWhatsNew,
  sortReleasesNewestFirst,
  unseenReleases,
  whatsNewIpChanged,
} from './whatsNew.js';

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    clear: () => store.clear(),
    store,
  };
}

const SAMPLE = [
  {
    build: 110,
    version: '1.26.4',
    title: 'Nou pe 110',
    highlights: ['Un lucru util'],
  },
  {
    build: 108,
    version: '1.26.2',
    title: 'Nou pe 108',
    highlights: ['Alt lucru'],
  },
];

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whatsNew', () => {
  it('parses build numbers and rejects junk', () => {
    expect(parseBuild('110')).toBe(110);
    expect(parseBuild(109)).toBe(109);
    expect(parseBuild('dev')).toBeNull();
    expect(parseBuild('')).toBeNull();
  });

  it('normalizes IPv4-mapped addresses', () => {
    expect(normalizeIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
    expect(normalizeIp('  10.0.0.1  ')).toBe('10.0.0.1');
    expect(normalizeIp('')).toBeNull();
  });

  it('treats IP change only when both sides are known', () => {
    expect(whatsNewIpChanged('1.1.1.1', '8.8.8.8')).toBe(true);
    expect(whatsNewIpChanged('1.1.1.1', '1.1.1.1')).toBe(false);
    expect(whatsNewIpChanged(null, '8.8.8.8')).toBe(false);
    expect(whatsNewIpChanged('1.1.1.1', null)).toBe(false);
  });

  it('sorts releases newest first', () => {
    expect(sortReleasesNewestFirst(SAMPLE).map((r) => r.build)).toEqual([110, 108]);
  });

  it('lists only unseen builds up to the running build', () => {
    expect(unseenReleases(null, '110', SAMPLE).map((r) => r.build)).toEqual([110, 108]);
    expect(unseenReleases(108, '110', SAMPLE).map((r) => r.build)).toEqual([110]);
    expect(unseenReleases(110, '110', SAMPLE)).toEqual([]);
    expect(unseenReleases(null, '108', SAMPLE).map((r) => r.build)).toEqual([108]);
  });

  it('persists build + ip and drives auto-open', () => {
    expect(getSeenWhatsNewBuild()).toBeNull();
    expect(shouldAutoOpenWhatsNew('110', SAMPLE, '1.1.1.1')).toBe(true);

    markWhatsNewSeen(110, '1.1.1.1');
    expect(JSON.parse(localStorage.getItem(WHATS_NEW_SEEN_KEY))).toEqual({
      build: 110,
      ip: '1.1.1.1',
    });
    expect(localStorage.getItem(WHATS_NEW_SEEN_BUILD_KEY)).toBe('110');
    expect(getSeenWhatsNew()).toEqual({ build: 110, ip: '1.1.1.1' });
    expect(shouldAutoOpenWhatsNew('110', SAMPLE, '1.1.1.1')).toBe(false);
  });

  it('re-opens on the same build when the client IP changes', () => {
    markWhatsNewSeen(110, '1.1.1.1');
    expect(shouldAutoOpenWhatsNew('110', SAMPLE, '1.1.1.1')).toBe(false);
    expect(shouldAutoOpenWhatsNew('110', SAMPLE, '8.8.8.8')).toBe(true);
    expect(effectiveSeenBuild(getSeenWhatsNew(), '8.8.8.8')).toBeNull();
    expect(releasesForModal({
      all: false,
      currentBuild: '110',
      releases: SAMPLE,
      currentIp: '8.8.8.8',
    }).map((r) => r.build)).toEqual([110, 108]);
  });

  it('does not re-open on IP change when stored ip is missing (legacy)', () => {
    localStorage.setItem(WHATS_NEW_SEEN_BUILD_KEY, '110');
    expect(getSeenWhatsNew()).toEqual({ build: 110, ip: null });
    expect(shouldAutoOpenWhatsNew('110', SAMPLE, '8.8.8.8')).toBe(false);
  });

  it('releasesForModal can show all known notes or only unseen', () => {
    markWhatsNewSeen(108, '1.1.1.1');
    expect(releasesForModal({
      all: false,
      currentBuild: '110',
      releases: SAMPLE,
      currentIp: '1.1.1.1',
    }).map((r) => r.build)).toEqual([110]);
    expect(releasesForModal({
      all: true,
      currentBuild: '110',
      releases: SAMPLE,
    }).map((r) => r.build)).toEqual([110, 108]);
  });

  it('ships at least one client-facing note and at most WHATS_NEW_KEEP', () => {
    expect(WHATS_NEW_RELEASES.length).toBeGreaterThan(0);
    expect(WHATS_NEW_RELEASES.length).toBeLessThanOrEqual(WHATS_NEW_KEEP);
    expect(keepNewestWhatsNewReleases([
      { build: 1, title: 'a', highlights: ['x'] },
      { build: 6, title: 'f', highlights: ['x'] },
      { build: 5, title: 'e', highlights: ['x'] },
      { build: 4, title: 'd', highlights: ['x'] },
      { build: 3, title: 'c', highlights: ['x'] },
      { build: 2, title: 'b', highlights: ['x'] },
    ]).map((r) => r.build)).toEqual([6, 5, 4, 3, 2]);
    for (const release of WHATS_NEW_RELEASES) {
      expect(release.build).toBeGreaterThan(0);
      expect(String(release.title || '').length).toBeGreaterThan(8);
      expect(release.highlights?.length).toBeGreaterThan(0);
      const blob = [release.title, ...(release.highlights || [])].join(' ');
      expect(blob).not.toMatch(/pdf\.js|iframe|canvas|poll|localStorage/i);
    }
  });

  it('swallows localStorage failures', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => markWhatsNewSeen(110, '1.1.1.1')).not.toThrow();
    spy.mockRestore();
  });

  it('reads clientIp from /api/health', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, clientIp: '::ffff:10.0.0.5' }),
    }));
    await expect(fetchWhatsNewClientIp(fetchImpl)).resolves.toBe('10.0.0.5');
  });
});
