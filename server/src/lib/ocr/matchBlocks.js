/**
 * Match extracted field values to normalised OCR blocks (same idea as src/lib/ocrBlocks.js).
 * Used server-side to pull provider block confidence onto field scores after extraction.
 */

const MIN_TOKEN = 4;

export function looseText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
}

function valueCandidates(value) {
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const out = new Set();
  out.add(raw);
  out.add(raw.replace(/^TPO-/i, 'TPO'));
  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) out.add(String(n));
  }
  return [...out].map(looseText).filter((s) => s.length >= 2);
}

function significantTokens(value) {
  return String(value ?? '')
    .split(/[\s,;/\--]+/)
    .map(looseText)
    .filter((t) => t.length >= MIN_TOKEN && !/^\d{1,3}$/.test(t));
}

/** Blocks that plausibly carry `value`, best first. */
export function matchBlocksForValue(blocks, value) {
  const list = Array.isArray(blocks) ? blocks : [];
  const candidates = valueCandidates(value);
  if (!candidates.length) return [];
  const tokens = significantTokens(value);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i];
    if (!block?.text) continue;
    const hay = looseText(block.text);
    if (!hay) continue;
    let score = 0;
    if (candidates.some((c) => c.length >= 3 && hay.includes(c))) score = 1;
    else if (
      tokens.length >= 2
      && tokens.filter((t) => hay.includes(t)).length >= Math.min(2, tokens.length)
    ) {
      score = 0.5;
    }
    if (score > 0) out.push({ index: i, block, score });
  }
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}
