import { describe, expect, it } from 'vitest';
import {
  buildTerritoryDrafts,
  clusterLocations,
  convexHull,
  locationWeight,
} from './territories.js';

/** Mulberry32 — deterministic PRNG for stable clustering tests. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RO = [
  { id: 'a', latitude: 44.43, longitude: 26.10, volume_mc: 2, weight_kg: 500 },
  { id: 'b', latitude: 44.45, longitude: 26.12, volume_mc: 1, weight_kg: 200 },
  { id: 'c', latitude: 46.77, longitude: 23.59, volume_mc: 3, weight_kg: 800 },
  { id: 'd', latitude: 46.78, longitude: 23.61, volume_mc: 2, weight_kg: 400 },
  { id: 'e', latitude: 45.75, longitude: 21.23, volume_mc: 2, weight_kg: 600 },
  { id: 'f', latitude: 45.76, longitude: 21.25, volume_mc: 1, weight_kg: 300 },
  { id: 'g', latitude: 47.16, longitude: 27.58, volume_mc: 2, weight_kg: 450 },
  { id: 'h', latitude: 47.17, longitude: 27.60, volume_mc: 1, weight_kg: 250 },
  { id: 'i', latitude: 44.18, longitude: 28.63, volume_mc: 2, weight_kg: 500 },
  { id: 'j', latitude: 44.19, longitude: 28.65, volume_mc: 1, weight_kg: 200 },
];

describe('locationWeight', () => {
  it('never returns zero', () => {
    expect(locationWeight({})).toBe(1);
    expect(locationWeight({ volume_mc: 2 })).toBeGreaterThan(1);
  });
});

describe('convexHull', () => {
  it('returns a closed ring', () => {
    const ring = convexHull([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 0 },
      { latitude: 0.5, longitude: 0.5 },
    ]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBeGreaterThanOrEqual(4);
  });
});

describe('clusterLocations', () => {
  it('produces k non-empty clusters covering every point', () => {
    const { clusters } = clusterLocations(RO, { k: 5, random: mulberry32(42) });
    expect(clusters.length).toBe(5);
    const ids = clusters.flatMap((c) => c.location_ids).sort();
    expect(ids).toEqual(RO.map((r) => r.id).sort());
  });
});

describe('buildTerritoryDrafts + balance', () => {
  it('builds polygons for each cluster', () => {
    const { drafts, balance } = buildTerritoryDrafts(RO, { k: 5, random: mulberry32(7) });
    expect(drafts).toHaveLength(5);
    expect(drafts.every((d) => d.polygon?.geometry?.type === 'Polygon')).toBe(true);
    expect(balance.rows).toHaveLength(5);
  });

  it('keeps deviation ≤ 15% on an even grid', () => {
    const grid = [];
    for (let i = 0; i < 20; i += 1) {
      grid.push({
        id: `g${i}`,
        latitude: 44 + (i % 5) * 0.4,
        longitude: 26 + Math.floor(i / 5) * 0.4,
        volume_mc: 1,
        weight_kg: 100,
        stop_count: 1,
      });
    }
    const { balance } = buildTerritoryDrafts(grid, { k: 5, random: mulberry32(1) });
    expect(balance.max_deviation_pct).toBeLessThanOrEqual(15);
    expect(balance.balanced).toBe(true);
  });
});
