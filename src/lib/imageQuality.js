/**
 * Is this photo sharp enough to read?
 *
 * A driver photographing an aviz in a moving cab produces blurred frames often enough that the
 * office finds out only later, from an empty extraction. Checking in the browser costs nothing,
 * happens before the upload spends their data, and lets the answer be "take it again" instead of
 * silence.
 *
 * The measure is the variance of the Laplacian: a sharp image has strong local intensity changes
 * at edges, a blurred one has few. It is a heuristic, so it never blocks — the driver can always
 * send anyway, and a document nobody can read is still better than a document nobody sent.
 */

/** Longest side the check downscales to. Enough detail to judge, cheap enough for a phone. */
export const SAMPLE_MAX_SIDE = 640;

/**
 * Below this, warn. Calibrated against downscaled phone photos, not a physical constant — if
 * real avize keep tripping it, move the number rather than removing the warning.
 */
export const SHARPNESS_MIN = 55;

/** Rec. 601 luma from packed RGBA, which is what a canvas hands back. */
export function toGrayscale(rgba) {
  const gray = new Float32Array(rgba.length / 4);
  for (let i = 0, g = 0; i < rgba.length; i += 4, g += 1) {
    gray[g] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return gray;
}

/**
 * Variance of the 3×3 Laplacian over a grayscale plane.
 *
 * Edge pixels are skipped rather than padded: a padded border invents contrast that is not in
 * the photograph, and on a small sample that is enough to call a blurred image sharp.
 */
export function laplacianVariance(gray, width, height) {
  if (!width || !height || width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value = (
        4 * gray[i]
        - gray[i - 1]
        - gray[i + 1]
        - gray[i - width]
        - gray[i + width]
      );
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }

  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function isBlurry(score, threshold = SHARPNESS_MIN) {
  return Number.isFinite(score) && score < threshold;
}

/** Target size that keeps the aspect ratio and the longest side within `SAMPLE_MAX_SIDE`. */
export function sampleSize(width, height, maxSide = SAMPLE_MAX_SIDE) {
  const longest = Math.max(width, height);
  if (!longest) return { width: 0, height: 0 };
  const scale = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Measures one image file in the browser.
 *
 * Returns `null` when the check cannot run — an unsupported file, a browser without the APIs, a
 * decode failure. A check that could not run must never be reported as a failed check.
 */
export async function measurePhotoSharpness(file) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = sampleSize(bitmap.width, bitmap.height);
    if (width < 3 || height < 3) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return laplacianVariance(toGrayscale(data), width, height);
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

/**
 * The blurriest of a set, so a driver sending four photos hears about the one that needs redoing.
 * Files the check could not read are skipped, never counted as blurred.
 */
export async function findBlurriest(files, threshold = SHARPNESS_MIN) {
  let worst = null;
  for (const file of files) {
    const score = await measurePhotoSharpness(file);
    if (score == null) continue;
    if (!worst || score < worst.score) worst = { file, score };
  }
  if (!worst || !isBlurry(worst.score, threshold)) return null;
  return worst;
}
