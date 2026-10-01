/**
 * Light image preparation before an upload: orientation, size, contrast.
 *
 * Mistral reads a phone photo well as it is. What it does not need is a 12 MP, 6 MB frame
 * with the page sideways in the EXIF — the upload costs the driver data, the OCR pays for
 * pixels that carry nothing, and a sideways page is one more thing for the reader to work
 * out. So, in the browser, before the blur check and the send:
 *
 *   1. apply the EXIF orientation (the pixels are rotated, the tag is dropped),
 *   2. downscale so the longest side is at most `MAX_SIDE` — ~300 dpi for an A4 page,
 *      more than any OCR uses,
 *   3. stretch the contrast when the frame is washed out (a shadowed cab, a grey photocopy),
 *      and only then — a well-exposed page is left alone,
 *   4. re-encode as JPEG.
 *
 * Every step is conservative and the whole thing is best-effort: anything that cannot be
 * decoded, a browser without the APIs, a result that came out *larger* — the original file
 * is sent as it was. Preparation must never be the reason a document did not arrive.
 *
 * PDFs and anything that is not an image pass straight through.
 */

import { sampleSize, toGrayscale } from './imageQuality.js';

/** Longest side after downscaling. A4 at ~300 dpi is 3508 px; 2600 keeps handwriting legible. */
export const MAX_SIDE = 2600;
/** Images already under this many bytes and within MAX_SIDE are not re-encoded. */
export const SKIP_BELOW_BYTES = 1_200_000;
/** JPEG quality for the re-encode. */
export const JPEG_QUALITY = 0.88;
/** Luma range (p1..p99) under which the frame counts as washed out and gets stretched. */
export const LOW_CONTRAST_RANGE = 150;
/** Percentiles clipped by the stretch; 1 % each side ignores specks and glare. */
export const CLIP_PERCENT = 0.01;

/** 256-bin histogram of a grayscale plane. */
export function lumaHistogram(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    hist[v < 0 ? 0 : v > 255 ? 255 : v | 0] += 1;
  }
  return hist;
}

/**
 * Where to stretch from, given a histogram: the 1st and 99th percentile luma.
 * Returns `null` when the frame already uses its range (nothing to do) or is degenerate.
 *
 * @returns {{ low: number, high: number } | null}
 */
export function contrastStretchParams(hist, { clip = CLIP_PERCENT, minRange = LOW_CONTRAST_RANGE } = {}) {
  let total = 0;
  for (let i = 0; i < hist.length; i += 1) total += hist[i];
  if (!total) return null;
  const target = total * clip;

  let acc = 0;
  let low = 0;
  while (low < 255 && acc + hist[low] < target) { acc += hist[low]; low += 1; }

  acc = 0;
  let high = 255;
  while (high > 0 && acc + hist[high] < target) { acc += hist[high]; high -= 1; }

  if (high - low < 8) return null; // flat frame — a stretch would amplify noise only
  if (high - low >= minRange) return null; // already contrasty — leave the exposure alone
  return { low, high };
}

/** Linear stretch of `low..high` onto `0..255`, in place on packed RGBA, alpha untouched. */
export function applyContrastStretch(rgba, { low, high }) {
  const scale = 255 / (high - low);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = Math.round((v - low) * scale);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = lut[rgba[i]];
    rgba[i + 1] = lut[rgba[i + 1]];
    rgba[i + 2] = lut[rgba[i + 2]];
  }
  return rgba;
}

/**
 * Decide, without touching pixels, whether a file is worth preparing.
 * Exported so the decision is testable without a canvas.
 */
export function shouldPrepare(file, { width, height } = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return false;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return false;
  const tooLarge = Math.max(width || 0, height || 0) > MAX_SIDE;
  return tooLarge || file.size > SKIP_BELOW_BYTES;
}

function jpegName(name) {
  const base = String(name || 'foto').replace(/\.[^.]+$/, '');
  return `${base}.jpg`;
}

/**
 * Prepares one file. Resolves to the original on any failure or when there is nothing to gain.
 * @returns {Promise<File>}
 */
export async function prepareImageForUpload(file, {
  maxSide = MAX_SIDE,
  quality = JPEG_QUALITY,
  contrast = true,
} = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap;
  try {
    // `from-image` bakes the EXIF orientation into the pixels; the re-encoded JPEG has none.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!shouldPrepare(file, bitmap)) return file;

    const { width, height } = sampleSize(bitmap.width, bitmap.height, maxSide);
    if (width < 16 || height < 16) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: Boolean(contrast) });
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (contrast) {
      const image = ctx.getImageData(0, 0, width, height);
      const params = contrastStretchParams(lumaHistogram(toGrayscale(image.data)));
      if (params) {
        applyContrastStretch(image.data, params);
        ctx.putImageData(image, 0, 0);
      }
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size === 0) return file;
    // A re-encode that grew the file (an already tight JPEG) is not an improvement.
    if (blob.size >= file.size && Math.max(bitmap.width, bitmap.height) <= maxSide) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

/**
 * Prepares a batch, in order, within a time budget. Past the budget the remaining files go
 * as they are — the send is what matters, the trim is a courtesy.
 */
export async function prepareImagesForUpload(files, { timeoutMs = 8_000, ...opts } = {}) {
  const list = Array.from(files || []);
  const out = [];
  const deadline = Date.now() + timeoutMs;
  for (const file of list) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { out.push(file); continue; }
    // One decode can hang on a cold phone; the race means it costs at most the budget left,
    // not the send.
    let timer;
    const prepared = await Promise.race([
      prepareImageForUpload(file, opts).catch(() => file),
      new Promise((resolve) => { timer = setTimeout(() => resolve(file), remaining); }),
    ]).finally(() => clearTimeout(timer));
    out.push(prepared);
  }
  return out;
}
