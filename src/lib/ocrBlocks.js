/**
 * Field ↔ OCR block matching and overlay geometry for the HITL drawer.
 *
 * Blocks arrive in the server's normalised shape
 * (`{ page, type, text, confidence, bbox: {x0,y0,x1,y1}, page_width, page_height }`,
 * see `server/src/lib/ocr/ocrBlocks.js`). Nothing here knows the provider.
 *
 * Matching is deliberately loose: a TPO typed as `TPO-0025629` has to find the block that
 * reads `TP0 - 0025629`, a date stored as `2026-09-14` has to find `14.09.2026`, a weight
 * stored as `9000.00` has to find `9.000 kg`. A miss costs the operator a glance at the whole
 * page; a false hit draws a box on the wrong line, which is worse - so a match needs the
 * whole value (or a long token of it), never a lone digit pair.
 */

export const LOW_CONFIDENCE_BELOW = 0.7;
const MIN_TOKEN = 4;

/** Uppercase, letter→digit look-alikes folded, everything non-alphanumeric dropped. */
export function looseText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
}

/** Candidate spellings of one value as they might appear on the page. */
export function valueCandidates(value) {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const out = new Set();

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) {
    const [, y, m, d] = iso;
    out.add(`${d}${m}${y}`);
    out.add(`${d}${m}${y.slice(2)}`);
    out.add(`${y}${m}${d}`);
    return [...out].map(looseText).filter(Boolean);
  }

  out.add(raw);
  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    // 9000.00 → 9000, 12.5 → 12,5 / 125 after loosening.
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) {
      out.add(String(n));
      if (Number.isInteger(n)) out.add(n.toLocaleString('de-DE'));
    }
  }
  return [...out].map(looseText).filter((s) => s.length >= 2);
}

function significantTokens(value) {
  return String(value ?? '')
    .split(/[\s,;/\--]+/)
    .map(looseText)
    .filter((t) => t.length >= MIN_TOKEN && !/^\d{1,3}$/.test(t));
}

/**
 * Blocks that plausibly carry `value`, best first. `score` is 1 for a whole-value hit and
 * 0.5 for a token hit; anything below that is not reported.
 */
export function matchBlocksForValue(blocks, value, { page } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const candidates = valueCandidates(value);
  if (!candidates.length) return [];
  const tokens = significantTokens(value);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i];
    if (!block?.text) continue;
    if (page != null && block.page !== page) continue;
    const hay = looseText(block.text);
    if (!hay) continue;
    let score = 0;
    if (candidates.some((c) => c.length >= 3 && hay.includes(c))) score = 1;
    else if (tokens.length >= 2 && tokens.filter((t) => hay.includes(t)).length >= Math.min(2, tokens.length)) score = 0.5;
    if (score > 0) out.push({ index: i, block, score });
  }
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Match every field at once; `{ [field]: matches[] }`, fields without a hit omitted. */
export function matchFields(blocks, values, { page } = {}) {
  const out = {};
  for (const [field, value] of Object.entries(values || {})) {
    const m = matchBlocksForValue(blocks, value, { page });
    if (m.length) out[field] = m;
  }
  return out;
}

/**
 * Where an `object-fit: contain` image actually sits inside its box.
 * @returns {{left:number, top:number, width:number, height:number}} in container pixels
 */
export function containedRect(containerW, containerH, naturalW, naturalH) {
  if (!(containerW > 0 && containerH > 0 && naturalW > 0 && naturalH > 0)) {
    return { left: 0, top: 0, width: containerW || 0, height: containerH || 0 };
  }
  const scale = Math.min(containerW / naturalW, containerH / naturalH);
  const width = naturalW * scale;
  const height = naturalH * scale;
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height };
}

/**
 * CSS box for one block inside `rect`, scaling the block's page space onto the rendered
 * image. Falls back to the image's natural size when the provider sent no page dimensions.
 * Returns null for a block without a usable bbox.
 */
export function blockBox(block, rect, natural) {
  const b = block?.bbox;
  if (!b || !rect) return null;
  const pw = block.page_width || natural?.width;
  const ph = block.page_height || natural?.height;
  if (!(pw > 0 && ph > 0)) return null;
  const x0 = Math.max(0, Math.min(b.x0, b.x1));
  const y0 = Math.max(0, Math.min(b.y0, b.y1));
  const x1 = Math.min(pw, Math.max(b.x0, b.x1));
  const y1 = Math.min(ph, Math.max(b.y0, b.y1));
  if (!(x1 > x0 && y1 > y0)) return null;
  return {
    left: rect.left + (x0 / pw) * rect.width,
    top: rect.top + (y0 / ph) * rect.height,
    width: ((x1 - x0) / pw) * rect.width,
    height: ((y1 - y0) / ph) * rect.height,
  };
}

export function isLowConfidence(block, threshold = LOW_CONFIDENCE_BELOW) {
  return block?.confidence != null && Number(block.confidence) < threshold;
}

/* Component-facing aliases - the drawer and the overlay speak in blocks and percentages. */

/** Matching blocks themselves (not the match records), best first. */
export function blocksForValue(blocks, value, opts) {
  return matchBlocksForValue(blocks, value, opts).map((m) => m.block);
}

export const isLowConfidenceBlock = isLowConfidence;

const PERCENT_RECT = Object.freeze({ left: 0, top: 0, width: 100, height: 100 });

/**
 * Block position as percentages of the rendered page, for a wrapper that hugs the image.
 * `fallback` is `{ width, height }` of the natural image when the page has no dimensions.
 */
export function blockRect(block, fallback) {
  return blockBox(block, PERCENT_RECT, fallback);
}
