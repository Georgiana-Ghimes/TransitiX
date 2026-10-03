/**
 * One aviz per PDF page: a bulk scan becomes N single-page files the extractor already
 * understands. No TPO detection — if two notes share a page, that is a later problem.
 */
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { uniqueUploadFilename } from '../concurrency.js';
import { publicUploadUrl, uploadRoot } from '../../uploadPath.js';

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
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<Buffer[]>} one buffer per page, in order
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
  const pages = [];
  for (let i = 0; i < total; i += 1) {
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [i]);
    out.addPage(copied);
    const bytes = await out.save();
    pages.push(Buffer.from(bytes));
  }
  return pages;
}

/** Display name the list shows: original plus which page it came from. */
export function splitPageFilename(originalName, pageIndex, total) {
  const base = String(originalName || 'document.pdf').trim() || 'document.pdf';
  return `${base} · pag. ${pageIndex + 1}/${total}`;
}

/**
 * Reads a stored upload, splits it when it has more than one page, writes single-page PDFs.
 *
 * @returns {Promise<null | { pages: number, files: Array<{ file_url: string, original_filename: string, page: number }> }>}
 *   `null` when the file is not a multi-page PDF (caller keeps the original row).
 */
export async function materializePdfPageFiles(fileUrl, {
  originalFilename,
  companyId,
} = {}) {
  const name = path.basename(String(fileUrl || ''));
  if (!name || !/\.pdf$/i.test(name)) return null;

  const buffer = await fs.readFile(path.resolve(uploadRoot, name));
  const pageBuffers = await splitPdfToPages(buffer);
  if (pageBuffers.length <= 1) return null;

  const total = pageBuffers.length;
  const label = originalFilename || name;
  const files = [];
  for (let i = 0; i < total; i += 1) {
    const filename = uniqueUploadFilename(
      `${path.basename(label, path.extname(label)) || 'aviz'}-p${i + 1}.pdf`,
      { companyId }
    );
    await fs.writeFile(path.resolve(uploadRoot, filename), pageBuffers[i]);
    files.push({
      file_url: publicUploadUrl(filename),
      original_filename: splitPageFilename(label, i, total),
      page: i + 1,
    });
  }
  return { pages: total, files };
}
