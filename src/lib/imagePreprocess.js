/**
 * Light image preparation before an upload: orientation, size, contrast.
 *
 * Mistral reads a phone photo well as it is. What it does not need is a 12 MP, 6 MB frame
 * with the page sideways in the EXIF - the upload costs the driver data, the OCR pays for
 * pixels that carry nothing, and a sideways page is one more thing for the reader to work
 * out.
 *
 *   1. apply the EXIF orientation (the pixels are rotated, the tag is dropped),
 *   2. optionally upright the page (`preferPortrait`: try 0/90/180/270, keep portrait +
 *      horizontal text + header toward the top — fixes sideways and upside-down phone shots),
 *   3. downscale so the longest side is at most `MAX_SIDE` - ~300 dpi for an A4 page,
 *   4. stretch the contrast when the frame is washed out,
 *   5. re-encode as JPEG.
 *
 * Small WhatsApp JPEGs used to skip re-encode under `SKIP_BELOW_BYTES`, which left EXIF
 * sideways or a landscape frame of an A4 page. Orientation / portrait always force a bake.
 *
 * Ink→black greyscale is opt-in only (`inkNormalize: true`). Warm notebook photos have a
 * colour cast across the whole frame; treating that chroma as "pen" turns the page black
 * and OCR extracts nothing. Mistral handles red/blue ballpoint on colour images.
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
 * Default: only oversized frames. Opt-in ink mode / `force` prepares every photo.
 */
export function shouldPrepare(file, { width, height, inkNormalize = false, force = false } = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return false;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return false;
  if (force || inkNormalize) return true;
  const tooLarge = Math.max(width || 0, height || 0) > MAX_SIDE;
  return tooLarge || file.size > SKIP_BELOW_BYTES;
}

/** A4-style paperwork should end up taller than wide after upload. */
export function needsPortraitRotate(width, height) {
  return Number(width) > Number(height) && Number(height) > 0;
}

/**
 * Compare oriented vs raw bitmap sizes. When EXIF Orientation flips axes, we must re-encode
 * or small WhatsApp JPEGs skip preparation and keep the sideways tag/pixels.
 */
export function orientationAxesDiffer(oriented, raw) {
  if (!oriented || !raw) return false;
  return oriented.width !== raw.width || oriented.height !== raw.height;
}

/** Max side of the thumbnail used to pick 0/90/180/270. */
export const ORIENT_SAMPLE_SIDE = 480;

/** Paper / ink thresholds on Rec.601 luma (0..255). */
export const PAPER_LUMA_MIN = 175;
export const INK_LUMA_MAX = 140;

function arrayVariance(values) {
  if (!values || !values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  const mean = sum / values.length;
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - mean;
    acc += d * d;
  }
  return acc / values.length;
}

/**
 * Score a decoded RGBA frame for “upright A4 paperwork”.
 * Higher is better: text lines run horizontally, and the denser header band sits toward the top.
 *
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
export function scoreDocumentOrientation(rgba, width, height) {
  if (!rgba || width < 8 || height < 8) return -Infinity;
  const gray = toGrayscale(rgba);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let paper = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (gray[y * width + x] < PAPER_LUMA_MIN) continue;
      paper += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (paper < width * height * 0.04) {
    minX = 0;
    minY = 0;
    maxX = width - 1;
    maxY = height - 1;
  }

  const pw = maxX - minX + 1;
  const ph = maxY - minY + 1;
  const rowInk = new Float64Array(ph);
  const colInk = new Float64Array(pw);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (gray[y * width + x] > INK_LUMA_MAX) continue;
      rowInk[y - minY] += 1;
      colInk[x - minX] += 1;
    }
  }

  const rowVar = arrayVariance(rowInk);
  const colVar = arrayVariance(colInk);
  // Horizontal text → row projection varies more than column projection.
  const horiz = (rowVar - colVar) / (rowVar + colVar + 1e-6);

  const band = Math.max(1, Math.floor(ph * 0.33));
  let topInk = 0;
  let botInk = 0;
  for (let i = 0; i < band; i += 1) topInk += rowInk[i];
  for (let i = ph - band; i < ph; i += 1) botInk += rowInk[i];
  const header = (topInk - botInk) / (topInk + botInk + 1e-6);

  // Portrait pages of forms: horizontality first, then header-up.
  return horiz * 2 + header;
}

/**
 * Output size after rotating the source by `degrees` (0/90/180/270 CW).
 */
export function sizeAfterRotation(width, height, degrees) {
  const deg = ((Number(degrees) % 360) + 360) % 360;
  if (deg === 90 || deg === 270) return { width: height, height: width };
  return { width, height };
}

/**
 * Pick the rotation (CW degrees) that best uprights a document thumbnail.
 * When `preferPortrait` is set, landscape results are skipped.
 *
 * @param {Array<{ degrees: number, score: number, width: number, height: number }>} candidates
 * @param {{ preferPortrait?: boolean }} [opts]
 * @returns {number} degrees CW
 */
export function pickBestDocumentRotation(candidates, { preferPortrait = false } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let pool = preferPortrait
    ? list.filter((c) => Number(c.height) >= Number(c.width))
    : list;
  if (!pool.length) pool = list;
  let best = pool[0] || { degrees: 0, score: -Infinity };
  for (let i = 1; i < pool.length; i += 1) {
    const c = pool[i];
    if (c.score > best.score) best = c;
  }
  return Number(best.degrees) || 0;
}

function jpegName(name) {
  const base = String(name || 'foto').replace(/\.[^.]+$/, '');
  return `${base}.jpg`;
}

/**
 * Draw `bitmap` into `ctx` at `width`×`height`, with optional CW rotation.
 * Canvas must already be sized to the *output* dimensions (axes swapped for 90/270).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ImageBitmap|CanvasImageSource} bitmap
 * @param {number} width
 * @param {number} height
 * @param {{ degrees?: number, rotateCw90?: boolean }} [opts]  `rotateCw90` kept for callers; prefers `degrees`.
 */
export function drawBitmapOriented(ctx, bitmap, width, height, { degrees, rotateCw90 = false } = {}) {
  if (!ctx || !bitmap) return;
  let deg = degrees == null ? (rotateCw90 ? 90 : 0) : Number(degrees);
  deg = ((deg % 360) + 360) % 360;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (deg === 0) {
    ctx.drawImage(bitmap, 0, 0, width, height);
    return;
  }
  ctx.save();
  if (deg === 90) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bitmap, 0, 0, height, width);
  } else if (deg === 180) {
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
    ctx.drawImage(bitmap, 0, 0, width, height);
  } else if (deg === 270) {
    ctx.translate(0, height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(bitmap, 0, 0, height, width);
  } else {
    ctx.drawImage(bitmap, 0, 0, width, height);
  }
  ctx.restore();
}

/**
 * Score 0/90/180/270 on a small canvas and pick the upright portrait rotation.
 * @returns {number} degrees CW
 */
function chooseDocumentRotation(bitmap, { preferPortrait = false } = {}) {
  if (!preferPortrait || !bitmap || typeof document === 'undefined') return 0;
  const candidates = [];
  for (const degrees of [0, 90, 180, 270]) {
    const natural = sizeAfterRotation(bitmap.width, bitmap.height, degrees);
    const { width, height } = sampleSize(natural.width, natural.height, ORIENT_SAMPLE_SIDE);
    if (width < 8 || height < 8) continue;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    drawBitmapOriented(ctx, bitmap, width, height, { degrees });
    let score = -Infinity;
    try {
      const image = ctx.getImageData(0, 0, width, height);
      score = scoreDocumentOrientation(image.data, width, height);
    } catch {
      score = -Infinity;
    }
    candidates.push({ degrees, score, width, height });
  }
  return pickBestDocumentRotation(candidates, { preferPortrait });
}

/**
 * Prepares one file. Resolves to the original on any failure or when there is nothing to gain.
 * @param {object} [opts]
 * @param {boolean} [opts.preferPortrait]  Aviz phone photos: pick upright portrait (0/90/180/270).
 * @returns {Promise<File>}
 */
export async function prepareImageForUpload(file, {
  maxSide = MAX_SIDE,
  quality = JPEG_QUALITY,
  contrast = true,
  inkNormalize = false,
  preferPortrait = false,
} = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap;
  let rawBitmap;
  try {
    // `from-image` bakes the EXIF orientation into the pixels; the re-encoded JPEG has none.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let needsOrientBake = false;
    try {
      rawBitmap = await createImageBitmap(file, { imageOrientation: 'none' });
      needsOrientBake = orientationAxesDiffer(bitmap, rawBitmap);
    } catch {
      // Older engines without `none` — leave bake decision to size / preferPortrait.
      needsOrientBake = false;
    }
    const rotationDeg = preferPortrait ? chooseDocumentRotation(bitmap, { preferPortrait }) : 0;
    const needsContentRotate = rotationDeg !== 0;
    const mustReencode = needsOrientBake || needsContentRotate;

    if (!shouldPrepare(file, {
      width: bitmap.width,
      height: bitmap.height,
      inkNormalize,
      force: mustReencode,
    })) {
      return file;
    }

    const natural = sizeAfterRotation(bitmap.width, bitmap.height, rotationDeg);
    const { width, height } = sampleSize(natural.width, natural.height, maxSide);
    if (width < 16 || height < 16) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', {
      willReadFrequently: Boolean(contrast || inkNormalize),
    });
    if (!ctx) return file;
    drawBitmapOriented(ctx, bitmap, width, height, { degrees: rotationDeg });

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
    // Never discard a bake that fixed EXIF or portrait — that was the whole point.
    if (
      !mustReencode
      && !inkNormalize
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
    rawBitmap?.close?.();
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
