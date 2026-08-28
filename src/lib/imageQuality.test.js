import { describe, expect, it } from 'vitest';
import {
  SHARPNESS_MIN,
  isBlurry,
  laplacianVariance,
  sampleSize,
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
