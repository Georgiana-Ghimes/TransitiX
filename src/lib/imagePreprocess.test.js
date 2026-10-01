import { describe, expect, it } from 'vitest';
import {
  LOW_CONTRAST_RANGE,
  MAX_SIDE,
  SKIP_BELOW_BYTES,
  applyContrastStretch,
  contrastStretchParams,
  lumaHistogram,
  prepareImageForUpload,
  prepareImagesForUpload,
  shouldPrepare,
} from './imagePreprocess.js';

function hist(fill) {
  const h = new Uint32Array(256);
  for (const [v, n] of fill) h[v] = n;
  return h;
}

describe('shouldPrepare', () => {
  it('takes big or oversized photos and leaves documents and small files alone', () => {
    expect(shouldPrepare({ type: 'image/jpeg', size: SKIP_BELOW_BYTES + 1 })).toBe(true);
    expect(shouldPrepare({ type: 'image/jpeg', size: 100 }, { width: MAX_SIDE + 1, height: 10 })).toBe(true);
    expect(shouldPrepare({ type: 'image/jpeg', size: 100 }, { width: 800, height: 600 })).toBe(false);
    expect(shouldPrepare({ type: 'application/pdf', size: 10_000_000 })).toBe(false);
    expect(shouldPrepare({ type: 'image/gif', size: 10_000_000 })).toBe(false);
    expect(shouldPrepare({ type: 'image/svg+xml', size: 10_000_000 })).toBe(false);
    expect(shouldPrepare(null)).toBe(false);
  });
});

describe('contrastStretchParams', () => {
  it('returns null for an image that already uses its range', () => {
    expect(contrastStretchParams(hist([[5, 100], [128, 100], [250, 100]]))).toBeNull();
  });

  it('proposes a stretch for a flat grey page', () => {
    const p = contrastStretchParams(hist([[90, 100], [120, 1000], [160, 100]]));
    expect(p).toEqual({ low: 90, high: 160 });
    expect(160 - 90).toBeLessThan(LOW_CONTRAST_RANGE);
  });

  it('ignores a one-pixel outlier when picking percentiles', () => {
    const h = hist([[0, 1], [100, 1000], [140, 1000], [255, 1]]);
    expect(contrastStretchParams(h)).toEqual({ low: 100, high: 140 });
  });

  it('returns null for a flat colour or an empty histogram', () => {
    expect(contrastStretchParams(hist([[120, 500]]))).toBeNull();
    expect(contrastStretchParams(new Uint32Array(256))).toBeNull();
  });
});

describe('applyContrastStretch / lumaHistogram', () => {
  it('maps low→0 and high→255, clamps outside, leaves alpha', () => {
    const rgba = new Uint8ClampedArray([100, 140, 120, 200, 0, 255, 120, 7]);
    applyContrastStretch(rgba, { low: 100, high: 140 });
    expect(Array.from(rgba)).toEqual([0, 255, 128, 200, 0, 255, 128, 7]);
  });

  it('bins a grayscale plane', () => {
    const h = lumaHistogram(Float32Array.from([0, 255, 300, -4, 127.9]));
    expect(h[0]).toBe(2);
    expect(h[255]).toBe(2);
    expect(h[127]).toBe(1);
  });
});

describe('prepareImageForUpload outside a browser', () => {
  it('returns the original file untouched, never throws', async () => {
    const file = { name: 'a.jpg', type: 'image/jpeg', size: 5_000_000 };
    expect(await prepareImageForUpload(file)).toBe(file);
    const pdf = { name: 'a.pdf', type: 'application/pdf', size: 10 };
    expect(await prepareImageForUpload(pdf)).toBe(pdf);
  });

  it('batch keeps order and count, and a spent budget passes files through', async () => {
    const files = [{ name: '1.jpg', type: 'image/jpeg', size: 1 }, { name: '2.pdf', type: 'application/pdf', size: 1 }];
    expect(await prepareImagesForUpload(files)).toEqual(files);
    expect(await prepareImagesForUpload(files, { timeoutMs: 0 })).toEqual(files);
  });
});
