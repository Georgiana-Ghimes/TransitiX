/**
 * Provider-independent shape for OCR layout blocks.
 *
 * Mistral returns blocks per page with a bbox, a type and a confidence; the exact key names
 * have shifted between releases (`bbox` as an object, as an array, or as four `top_left_*` /
 * `bottom_right_*` fields). Everything downstream — the HITL overlay, the field→block match —
 * reads only this normalised form, so a provider change stops here.
 *
 *   { page, type, text, confidence, bbox: { x0, y0, x1, y1 }, page_width, page_height }
 *
 * Coordinates stay in the provider's pixel space of the page; `page_width` / `page_height`
 * are what a renderer scales against. Text is capped so a stored row does not carry the
 * whole document twice (raw_text already does).
 */

export const BLOCK_TEXT_MAX = 400;
export const BLOCKS_MAX = 400;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accepts the bbox spellings seen so far; null when none is usable. */
export function normalizeBbox(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x0, y0, x1, y1] = raw.map(num);
    if ([x0, y0, x1, y1].some((v) => v == null)) return null;
    return { x0, y0, x1, y1 };
  }
  if (typeof raw !== 'object') return null;

  if (raw.x0 != null && raw.x1 != null) {
    const b = { x0: num(raw.x0), y0: num(raw.y0), x1: num(raw.x1), y1: num(raw.y1) };
    return Object.values(b).some((v) => v == null) ? null : b;
  }
  if (raw.top_left_x != null) {
    const b = {
      x0: num(raw.top_left_x), y0: num(raw.top_left_y),
      x1: num(raw.bottom_right_x), y1: num(raw.bottom_right_y),
    };
    return Object.values(b).some((v) => v == null) ? null : b;
  }
  if (raw.x != null && (raw.w != null || raw.width != null)) {
    const x = num(raw.x);
    const y = num(raw.y);
    const w = num(raw.w ?? raw.width);
    const h = num(raw.h ?? raw.height);
    if ([x, y, w, h].some((v) => v == null)) return null;
    return { x0: x, y0: y, x1: x + w, y1: y + h };
  }
  return null;
}

/** One number in 0..1, whichever way the provider spelled it; null when absent. */
export function normalizeConfidence(block) {
  const direct = num(block?.confidence);
  if (direct != null) return clamp01(direct);
  const scores = block?.confidence_scores ?? block?.confidence_score;
  if (scores == null) return null;
  if (typeof scores === 'number') return clamp01(scores);
  if (Array.isArray(scores)) {
    const nums = scores.map(num).filter((v) => v != null);
    return nums.length ? clamp01(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  }
  if (typeof scores === 'object') {
    const nums = Object.values(scores).map(num).filter((v) => v != null);
    return nums.length ? clamp01(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  }
  return null;
}

function clamp01(v) {
  // Some providers report percentages.
  const n = v > 1 && v <= 100 ? v / 100 : v;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

export function blockText(block) {
  const t = block?.text ?? block?.markdown ?? block?.content ?? '';
  return String(t).replace(/\s+/g, ' ').trim().slice(0, BLOCK_TEXT_MAX);
}

/**
 * @param {object} block provider block
 * @param {number} page zero-based page index
 * @param {{width?: number, height?: number}} [dims] page dimensions in the same pixel space
 */
export function normalizeBlock(block, page, dims) {
  const bbox = normalizeBbox(block?.bbox ?? block?.bounding_box ?? block);
  return {
    page: Number.isInteger(page) ? page : 0,
    type: String(block?.type ?? block?.block_type ?? 'text'),
    text: blockText(block),
    confidence: normalizeConfidence(block),
    bbox,
    page_width: num(dims?.width),
    page_height: num(dims?.height),
  };
}

/**
 * Flattens a provider's `pages[]` into normalised blocks. Pages without blocks contribute
 * nothing; the count is capped so a dense dossier does not bloat the row.
 */
export function normalizePages(pages) {
  const out = [];
  const list = Array.isArray(pages) ? pages : [];
  for (let i = 0; i < list.length; i += 1) {
    const page = list[i];
    const dims = page?.dimensions ?? page?.dimension ?? null;
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const block of blocks) {
      out.push(normalizeBlock(block, Number.isInteger(page?.index) ? page.index : i, dims));
      if (out.length >= BLOCKS_MAX) return out;
    }
  }
  return out;
}
