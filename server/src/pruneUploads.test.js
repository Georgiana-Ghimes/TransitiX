import { describe, expect, it } from 'vitest';
import { basenameOf, planPrune } from './pruneUploads.js';

const now = 1_700_000_000_000;
const day = 24 * 60 * 60 * 1000;
const file = (name, ageDays = 30, size = 1000) =>
  ({ name, size, mtimeMs: now - ageDays * day, mtime: new Date(now - ageDays * day) });

describe('basenameOf', () => {
  it('reduces a stored URL to the name on disk', () => {
    expect(basenameOf('/uploads/abc-123.jpg')).toBe('abc-123.jpg');
    expect(basenameOf('https://host/uploads/abc-123.jpg?v=2')).toBe('abc-123.jpg');
  });

  it('yields nothing for values that are not paths', () => {
    expect(basenameOf('')).toBeNull();
    expect(basenameOf(null)).toBeNull();
    expect(basenameOf('/')).toBeNull();
  });
});

describe('planPrune', () => {
  it('removes only what nothing points at', () => {
    const plan = planPrune(
      [file('orfan.jpg'), file('aviz.pdf'), file('cmr.jpg')],
      new Set(['aviz.pdf', 'cmr.jpg']),
      { now },
    );
    expect(plan.orphans.map((o) => o.name)).toEqual(['orfan.jpg']);
    expect(plan.keptReferenced).toBe(2);
  });

  /** The document behind an export is evidence; disk space is not a reason to lose it. */
  it('keeps a referenced file however old it is', () => {
    const plan = planPrune([file('vechi.pdf', 4000)], new Set(['vechi.pdf']), { now });
    expect(plan.orphans).toHaveLength(0);
  });

  it('spares a fresh upload still waiting for its row', () => {
    const plan = planPrune(
      [file('tocmai-urcat.jpg', 0), file('uitat.jpg', 30)],
      new Set(),
      { now, minAgeMs: 7 * day },
    );
    expect(plan.orphans.map((o) => o.name)).toEqual(['uitat.jpg']);
    expect(plan.keptYoung).toBe(1);
  });

  it('adds up what would be reclaimed', () => {
    const plan = planPrune([file('a.jpg', 30, 2000), file('b.jpg', 30, 3000)], new Set(), { now });
    expect(plan.bytes).toBe(5000);
  });
});
