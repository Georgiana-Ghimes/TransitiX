/**
 * Split a multi-page PDF into separate avize only when the text layer shows
 * distinct document numbers (TRO / PSL) on different pages.
 *
 * A single aviz on two pages (header + continuation) must stay one file.
 * Blind one-page-per-file cutting is wrong for those.
 */
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { uniqueUploadFilename } from '../concurrency.js';
import { publicUploadUrl, uploadRoot } from '../../uploadPath.js';
import { parsePdf, rowsFromTextItems } from './pdfRows.js';

/** Same ceiling as a batch upload — a 200-page dump is not an aviz drop. */
export const MAX_SPLIT_PAGES = 40;

export class PdfSplitError extends Error {
  constructor(message, { status = 400, code = 'PDF_SPLIT' } = {}) {
    super(message);
    this.name = 'PdfSplitError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<number>}
 */
export async function countPdfPages(buffer) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return src.getPageCount();
}

/**
 * Per-page text from the PDF text layer (empty string when a page has none).
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<string[]>}
 */
export async function readPdfPageTexts(buffer) {
  const pages = [];
  const parsed = await parsePdf(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const text = rowsFromTextItems(content?.items);
      pages.push(text);
      return text;
    },
  });
  const total = Number(parsed?.numpages) || pages.length;
  while (pages.length < total) pages.push('');
  return pages.slice(0, total);
}

/**
 * Document-number keys that identify a distinct aviz (TRO / PSL — not TPO).
 * @param {string} text
 * @returns {Set<string>}
 */
export function avizDocumentKeys(text) {
  const keys = new Set();
  const re = /\b(TRO|PSL)[\s\-._]*(\d{4,})\b/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    keys.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return keys;
}

/**
 * How to cut pages into avize. Only when ≥2 distinct TRO/PSL numbers appear.
 * Continuation pages (no key, or the same key reprinted) stay with the previous aviz.
 *
 * @param {string[]} pageTexts
 * @returns {null | number[][]} page-index groups, or null = keep as one file
 */
export function planAvizPdfSplits(pageTexts) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [];
  if (pages.length <= 1) return null;

  const keysPerPage = pages.map((t) => avizDocumentKeys(t));
  const all = new Set();
  for (const set of keysPerPage) {
    for (const k of set) all.add(k);
  }
  if (all.size < 2) return null;

  /** @type {{ pages: number[], keys: Set<string> }[]} */
  const groups = [];
  let current = null;

  for (let i = 0; i < pages.length; i += 1) {
    const keys = keysPerPage[i];
    if (!current) {
      current = { pages: [i], keys: new Set(keys) };
      groups.push(current);
      continue;
    }
    if (keys.size === 0) {
      current.pages.push(i);
      continue;
    }
    let overlap = false;
    for (const k of keys) {
      if (current.keys.has(k)) {
        overlap = true;
        break;
      }
    }
    if (overlap) {
      current.pages.push(i);
      for (const k of keys) current.keys.add(k);
      continue;
    }
    current = { pages: [i], keys: new Set(keys) };
    groups.push(current);
  }

  if (groups.length < 2) return null;
  return groups.map((g) => g.pages);
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {number[][]} groups  page-index groups from {@link planAvizPdfSplits}
 * @returns {Promise<Buffer[]>}
 */
export async function splitPdfByGroups(buffer, groups) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total < 1) {
    throw new PdfSplitError('PDF-ul nu are nicio pagină.');
  }
  if (total > MAX_SPLIT_PAGES) {
    throw new PdfSplitError(
      `PDF-ul are ${total} pagini. Desparte-l în fișiere de cel mult ${MAX_SPLIT_PAGES} pagini `
      + 'sau încarcă avizele separat.',
      { code: 'PDF_TOO_MANY_PAGES' }
    );
  }
  const out = [];
  for (const indices of groups) {
    const safe = indices.filter((i) => i >= 0 && i < total);
    if (!safe.length) continue;
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, safe);
    for (const page of copied) doc.addPage(page);
    out.push(Buffer.from(await doc.save()));
  }
  return out;
}

/**
 * Low-level: one buffer per page (tests / callers that already decided to cut).
 * Prefer {@link materializePdfPageFiles}, which only cuts on distinct avize.
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<Buffer[]>}
 */
export async function splitPdfToPages(buffer) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total < 1) {
    throw new PdfSplitError('PDF-ul nu are nicio pagină.');
  }
  if (total > MAX_SPLIT_PAGES) {
    throw new PdfSplitError(
      `PDF-ul are ${total} pagini. Desparte-l în fișiere de cel mult ${MAX_SPLIT_PAGES} pagini `
      + 'sau încarcă avizele separat.',
      { code: 'PDF_TOO_MANY_PAGES' }
    );
  }
  const groups = Array.from({ length: total }, (_, i) => [i]);
  return splitPdfByGroups(buffer, groups);
}

/** Display name when each part is a single page of a page-per-aviz bulk. */
export function splitPageFilename(originalName, pageIndex, total) {
  const base = String(originalName || 'document.pdf').trim() || 'document.pdf';
  return `${base} · pag. ${pageIndex + 1}/${total}`;
}

/** Display name for an aviz part (may span several pages). */
export function splitAvizFilename(originalName, partIndex, totalParts) {
  const base = String(originalName || 'document.pdf').trim() || 'document.pdf';
  return `${base} · aviz ${partIndex + 1}/${totalParts}`;
}

/**
 * Reads a stored upload and, when the text layer shows ≥2 distinct TRO/PSL numbers,
 * writes one PDF per aviz (continuation pages stay with their document).
 *
 * @returns {Promise<null | { pages: number, files: Array<{ file_url: string, original_filename: string, page: number }> }>}
 *   `null` when the file should stay one row (single-page, one aviz on N pages, or no text IDs).
 */
export async function materializePdfPageFiles(fileUrl, {
  originalFilename,
  companyId,
} = {}) {
  const name = path.basename(String(fileUrl || ''));
  if (!name || !/\.pdf$/i.test(name)) return null;

  const buffer = await fs.readFile(path.resolve(uploadRoot, name));
  const pageCount = await countPdfPages(buffer);
  if (pageCount <= 1) return null;
  if (pageCount > MAX_SPLIT_PAGES) {
    throw new PdfSplitError(
      `PDF-ul are ${pageCount} pagini. Desparte-l în fișiere de cel mult ${MAX_SPLIT_PAGES} pagini `
      + 'sau încarcă avizele separat.',
      { code: 'PDF_TOO_MANY_PAGES' }
    );
  }

  let pageTexts = [];
  try {
    pageTexts = await readPdfPageTexts(buffer);
  } catch {
    // No usable text layer → cannot tell avize apart → keep as one document.
    return null;
  }
  while (pageTexts.length < pageCount) pageTexts.push('');
  pageTexts = pageTexts.slice(0, pageCount);

  const plan = planAvizPdfSplits(pageTexts);
  if (!plan) return null;

  const partBuffers = await splitPdfByGroups(buffer, plan);
  if (partBuffers.length <= 1) return null;

  const totalParts = partBuffers.length;
  const label = originalFilename || name;
  const allSinglePage = plan.every((g) => g.length === 1);
  const files = [];
  for (let i = 0; i < totalParts; i += 1) {
    const filename = uniqueUploadFilename(
      `${path.basename(label, path.extname(label)) || 'aviz'}-a${i + 1}.pdf`,
      { companyId }
    );
    await fs.writeFile(path.resolve(uploadRoot, filename), partBuffers[i]);
    const firstPage = plan[i][0];
    files.push({
      file_url: publicUploadUrl(filename),
      original_filename: allSinglePage
        ? splitPageFilename(label, firstPage, pageCount)
        : splitAvizFilename(label, i, totalParts),
      page: firstPage + 1,
      pages_in_part: plan[i].length,
    });
  }
  return { pages: totalParts, files };
}
