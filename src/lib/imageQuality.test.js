import { describe, expect, it } from 'vitest';
import {
  SHARPNESS_MIN,
  isBlurry,
  laplacianVariance,
  sampleSize,
  suggestThreshold,
  toGrayscale,
} from './imageQuality.js';

/** Packs a grayscale plane into RGBA, the way a canvas would hand it back. */
function rgbaFrom(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  gray.forEach((v, i) => {
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  });
  return out;
}

const flat = (w, h, value = 128) => new Float32Array(w * h).fill(value);

/** Hard alternating pixels — the sharpest edge content an image can have. */
function checkerboard(w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) out[y * w + x] = (x + y) % 2 ? 255 : 0;
  }
  return out;
}

/** A soft ramp: real content, but no local detail — what a smeared photo looks like. */
function gradient(w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) out[y * w + x] = (x / w) * 255;
  }
  return out;
}

describe('toGrayscale', () => {
  it('reads luma out of packed RGBA', () => {
    const gray = toGrayscale(rgbaFrom(new Float32Array([0, 128, 255])));
    expect(Math.round(gray[0])).toBe(0);
    expect(Math.round(gray[1])).toBe(128);
    expect(Math.round(gray[2])).toBe(255);
  });
});

describe('laplacianVariance', () => {
  it('is zero on a blank frame — no detail anywhere', () => {
    expect(laplacianVariance(flat(32, 32), 32, 32)).toBe(0);
  });

  it('is high on hard edges and low on a smooth ramp', () => {
    const sharp = laplacianVariance(checkerboard(32, 32), 32, 32);
    const smooth = laplacianVariance(gradient(32, 32), 32, 32);
    expect(sharp).toBeGreaterThan(smooth);
    expect(isBlurry(smooth)).toBe(true);
    expect(isBlurry(sharp)).toBe(false);
  });

  it('separates the two sides of the warning threshold', () => {
    expect(isBlurry(SHARPNESS_MIN - 1)).toBe(true);
    expect(isBlurry(SHARPNESS_MIN)).toBe(false);
  });

  it('refuses to guess on an image too small to sample', () => {
    expect(laplacianVariance(flat(2, 2), 2, 2)).toBe(0);
    expect(laplacianVariance(new Float32Array(), 0, 0)).toBe(0);
  });

  it('does not let an invented border pass for detail', () => {
    // Content only in the middle; a padded edge would add contrast the photo never had.
    const gray = flat(16, 16, 0);
    gray[8 * 16 + 8] = 255;
    const variance = laplacianVariance(gray, 16, 16);
    expect(variance).toBeGreaterThan(0);
    expect(Number.isFinite(variance)).toBe(true);
  });
});

describe('sampleSize', () => {
  it('shrinks the long side and keeps the aspect ratio', () => {
    expect(sampleSize(4000, 3000, 640)).toEqual({ width: 640, height: 480 });
    expect(sampleSize(3000, 4000, 640)).toEqual({ width: 480, height: 640 });
  });

  it('never upscales a photo that is already small', () => {
    expect(sampleSize(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });
});

describe('suggestThreshold', () => {
  const sample = (score, readable) => ({ score, readable });

  it('puts the line between two groups that do not overlap', () => {
    const out = suggestThreshold([
      sample(120, true), sample(200, true), sample(310, true),
      sample(10, false), sample(25, false), sample(40, false),
    ]);
    expect(out.threshold).toBeGreaterThan(40);
    expect(out.threshold).toBeLessThanOrEqual(120);
    expect(out.falseWarnings).toBe(0);
    expect(out.missed).toBe(0);
    expect(out.separable).toBe(true);
  });

  it('prefers a false warning over a missed blur when the groups overlap', () => {
    const out = suggestThreshold([
      sample(50, true), sample(60, true), sample(300, true),
      sample(55, false), sample(20, false),
    ]);
    expect(out.separable).toBe(false);
    // Letting the 55 through would cost an unreadable document; a warning costs one tap.
    expect(out.threshold).toBeGreaterThan(55);
    expect(out.missed).toBe(0);
  });

  it('says nothing useful when only one kind was labelled', () => {
    const out = suggestThreshold([sample(100, true), sample(200, true)]);
    expect(out.threshold).toBe(SHARPNESS_MIN);
    expect(out.separable).toBe(false);
    expect(out.blurry).toBe(0);
  });

  it('ignores samples that could not be measured', () => {
    const out = suggestThreshold([
      sample(null, true), sample(undefined, false),
      sample(300, true), sample(10, false),
    ]);
    expect(out.readable).toBe(1);
    expect(out.blurry).toBe(1);
  });
});
