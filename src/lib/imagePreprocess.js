/**
 * Light image preparation before an upload: orientation, size, ink, contrast.
 *
 * Mistral reads a phone photo well as it is. What it does not need is a 12 MP, 6 MB frame
 * with the page sideways in the EXIF - the upload costs the driver data, the OCR pays for
 * pixels that carry nothing, and a sideways page is one more thing for the reader to work
 * out. Coloured ballpoint (red TPO on a Baumit) also disappears into the page under some
 * lighting, so chromatic ink is forced to black and the page goes grayscale before contrast.
 *
 *   1. apply the EXIF orientation (the pixels are rotated, the tag is dropped),
 *   2. downscale so the longest side is at most `MAX_SIDE` - ~300 dpi for an A4 page,
 *   3. darken coloured ink and flatten to grayscale,
 *   4. stretch the contrast when the frame is washed out,
 *   5. re-encode as JPEG.
 *
 * Every step is conservative and the whole thing is best-effort: anything that cannot be
 * decoded, a browser without the APIs, a result that came out *larger* - the original file
 * is sent as it was. Preparation must never be the reason a document did not arrive.
 *
 * PDFs and anything that is not an image pass straight through (hybrid PDFs get a separate
 * handwriting OCR pass on the server).
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

  if (high - low < 8) return null; // flat frame - a stretch would amplify noise only
  if (high - low >= minRange) return null; // already contrasty - leave the exposure alone
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

/** Chroma (max−min channel) above this counts as ink, not paper tint. */
export const INK_CHROMA_MIN = 28;
/** How dark coloured ink becomes (0 = black). */
export const INK_DARK = 18;

/**
 * Force coloured pen strokes (red, blue, green) to near-black, then flatten to grayscale.
 * Printed black text stays; pale paper stays light. In-place on packed RGBA.
 */
export function applyInkToBlackGrayscale(rgba, {
  chromaMin = INK_CHROMA_MIN,
  inkDark = INK_DARK,
} = {}) {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const chroma = max - min;
    let y;
    if (chroma >= chromaMin && max < 245) {
      // Chromatic and not a bright highlight → treat as ink.
      y = inkDark;
    } else {
      y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    rgba[i] = y;
    rgba[i + 1] = y;
    rgba[i + 2] = y;
  }
  return rgba;
}

/**
 * Decide, without touching pixels, whether a file is worth preparing.
 * Exported so the decision is testable without a canvas.
 *
 * Ink normalisation runs on every photo (red TPO on a clean scan is often under 1.2 MB),
 * so size alone no longer skips the pass.
 */
export function shouldPrepare(file, { width, height, inkNormalize = true } = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return false;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return false;
  if (inkNormalize) return true;
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
  inkNormalize = true,
} = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap;
  try {
    // `from-image` bakes the EXIF orientation into the pixels; the re-encoded JPEG has none.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!shouldPrepare(file, { width: bitmap.width, height: bitmap.height, inkNormalize })) {
      return file;
    }

    const { width, height } = sampleSize(bitmap.width, bitmap.height, maxSide);
    if (width < 16 || height < 16) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', {
      willReadFrequently: Boolean(contrast || inkNormalize),
    });
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (inkNormalize || contrast) {
      const image = ctx.getImageData(0, 0, width, height);
      if (inkNormalize) applyInkToBlackGrayscale(image.data);
      if (contrast) {
        // After ink flattening the range is often still mid-grey; stretch more eagerly.
        const params = contrastStretchParams(lumaHistogram(toGrayscale(image.data)), {
          minRange: inkNormalize ? 200 : LOW_CONTRAST_RANGE,
        });
        if (params) applyContrastStretch(image.data, params);
      }
      ctx.putImageData(image, 0, 0);
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size === 0) return file;
    // Ink / contrast passes may grow a tiny JPEG; still worth sending the readable page.
    if (
      !inkNormalize
      && blob.size >= file.size
      && Math.max(bitmap.width, bitmap.height) <= maxSide
    ) {
      return file;
    }
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

/**
 * Prepares a batch, in order, within a time budget. Past the budget the remaining files go
 * as they are - the send is what matters, the trim is a courtesy.
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
