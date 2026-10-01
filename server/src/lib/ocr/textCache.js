/**
 * Remembers what OCR read, keyed on the bytes it read.
 *
 * A five-minute CPU read of a file already transcribed is the largest single waste in this
 * pipeline, and it happened routinely: a driver re-sends a photo the signal dropped, the office
 * uploads the PDF the driver already sent, the API restarts and the work in flight is gone.
 *
 * What „Re-extrage" means, given this:
 *
 *   - A *good* cached read (it carries a TPO/PSL/TRO code) is reused, and only the parsing runs
 *     again. That is what the button is for most of the time — the text was fine, the extractor
 *     has since improved, and reading the same bytes again would return the same characters.
 *   - A *weak* cached read is not reused. A blank or code-less read is exactly the case where
 *     reading again might do better: a sidecar that was mid-restart, a page that arrived while
 *     models were still loading.
 *
 * `OCR_PIPELINE_VERSION` covers the remaining case. When the OCR pipeline itself changes, last
 * week's text is not what today's code would produce, so bumping it re-reads everything.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../../db.js';
import { uploadRoot } from '../../uploadPath.js';
import { needsOcrFallback } from './readText.js';

/**
 * Bump on any change to what OCR produces, in Node or in a sidecar.
 *
 *   1 — flat text, pdf-parse default rendering
 *   2 — rows rebuilt from coordinates (pdfRows.js + sidecar rows_from_entries)
 *   3 — Mistral Document AI; provider-independent sanitiser (`sanitizeOcrText`) and layout
 *       blocks normalised with page size, cached beside the text
 */
export const OCR_PIPELINE_VERSION = Number(process.env.OCR_PIPELINE_VERSION) || 3;

/** How long an entry is worth keeping. Storage is cheap; a stale transcript is not useful. */
const TTL_DAYS = Number(process.env.OCR_CACHE_TTL_DAYS) || 120;

export async function fileSha256(fileUrl) {
  const name = path.basename(String(fileUrl || ''));
  if (!name) return null;
  try {
    const buffer = await fs.readFile(path.resolve(uploadRoot, name));
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

/**
 * A remembered read for these bytes, or null.
 *
 * @param {object} options
 * @param {boolean} [options.strongOnly]  only return a read that found a logistics code;
 *   set on „Re-extrage", where a weak transcript is the reason the operator pressed the button.
 */
export async function lookupOcrText(companyId, fileUrl, { strongOnly = false } = {}) {
  if (!companyId) return null;
  const hash = await fileSha256(fileUrl);
  if (!hash) return null;

  let rows;
  try {
    rows = (await query(
      `UPDATE ocr_text_cache SET used_at = NOW(), hits = hits + 1
       WHERE company_id = $1 AND content_sha256 = $2 AND pipeline_version = $3
       RETURNING text, source, pages, truncated, blocks`,
      [companyId, hash, OCR_PIPELINE_VERSION]
    )).rows;
  } catch (err) {
    // A cache is never allowed to fail a read; the sidecar is still there.
    console.warn('[ocr-cache] lookup failed:', err?.message || err);
    return null;
  }

  const hit = rows[0];
  if (!hit) return null;
  if (strongOnly && needsOcrFallback(hit.text)) return null;

  return {
    text: hit.text,
    source: hit.source,
    pages: hit.pages ?? undefined,
    truncated: Boolean(hit.truncated),
    ...(Array.isArray(hit.blocks) && hit.blocks.length ? { blocks: hit.blocks } : {}),
    cached: true,
  };
}

/** Stores a non-empty read. Empty is not cached — nothing was learned worth keeping. */
export async function storeOcrText(companyId, fileUrl, result) {
  if (!companyId || !result?.text?.trim()) return;
  const hash = await fileSha256(fileUrl);
  if (!hash) return;

  try {
    await query(
      `INSERT INTO ocr_text_cache
         (company_id, content_sha256, pipeline_version, text, source, pages, truncated, blocks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, content_sha256, pipeline_version) DO UPDATE SET
         text = EXCLUDED.text, source = EXCLUDED.source, pages = EXCLUDED.pages,
         truncated = EXCLUDED.truncated, blocks = EXCLUDED.blocks, used_at = NOW()`,
      [companyId, hash, OCR_PIPELINE_VERSION, result.text, result.source || 'ocr',
       Number(result.pages) || null, Boolean(result.truncated),
       Array.isArray(result.blocks) && result.blocks.length ? JSON.stringify(result.blocks) : null]
    );
  } catch (err) {
    console.warn('[ocr-cache] store failed:', err?.message || err);
  }
}

/** Drops entries nobody has touched in a long time, and every older pipeline version. */
export async function pruneOcrTextCache() {
  try {
    const result = await query(
      `DELETE FROM ocr_text_cache
       WHERE pipeline_version < $1
          OR used_at < NOW() - ($2 * INTERVAL '1 day')`,
      [OCR_PIPELINE_VERSION, TTL_DAYS]
    );
    return { removed: result.rowCount || 0 };
  } catch (err) {
    console.warn('[ocr-cache] prune failed:', err?.message || err);
    return { removed: 0 };
  }
}
