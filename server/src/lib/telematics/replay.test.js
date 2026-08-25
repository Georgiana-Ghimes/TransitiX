import { describe, expect, it } from 'vitest';
import {
  downsampleTrail,
  replayKpis,
  toLatLngPath,
  trailLengthM,
} from './replay.js';

describe('downsampleTrail', () => {
  it('keeps endpoints and drops near-duplicates', () => {
    const points = [
      { latitude: 44.4, longitude: 26.1 },
      { latitude: 44.40001, longitude: 26.10001 },
      { latitude: 44.41, longitude: 26.12 },
    ];
    const out = downsampleTrail(points, { minStepM: 40 });
    expect(out).toHaveLength(2);
    expect(out[0].latitude).toBe(44.4);
    expect(out[1].latitude).toBe(44.41);
  });
});

describe('trailLengthM', () => {
  it('is roughly the haversine sum', () => {
    const m = trailLengthM([
      { latitude: 44.4, longitude: 26.1 },
      { latitude: 45.0, longitude: 26.5 },
    ]);
    expect(m).toBeGreaterThan(50_000);
  });
});

describe('toLatLngPath', () => {
  it('accepts objects and GeoJSON lon/lat pairs', () => {
    expect(toLatLngPath([{ latitude: 44.4, longitude: 26.1 }])).toEqual([[44.4, 26.1]]);
    expect(toLatLngPath([[26.1, 44.4]])).toEqual([[44.4, 26.1]]);
  });
});

describe('replayKpis', () => {
  it('computes delta only when both sides exist', () => {
    expect(replayKpis({ plannedDistanceM: 100_000, actualDistanceM: 112_000 }).delta_km).toBe(12);
    expect(replayKpis({ plannedDistanceM: 100_000 }).delta_km).toBeNull();
  });
});
