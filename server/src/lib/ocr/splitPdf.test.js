import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  MAX_SPLIT_PAGES,
  PdfSplitError,
  countPdfPages,
  splitPageFilename,
  splitPdfToPages,
} from './splitPdf.js';

async function makePdf(pageCount) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([400, 200]);
    page.drawText(`Aviz page ${i + 1}`, { x: 40, y: 100, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

describe('splitPdf', () => {
  it('counts pages', async () => {
    expect(await countPdfPages(await makePdf(3))).toBe(3);
  });

  it('splits into one buffer per page', async () => {
    const parts = await splitPdfToPages(await makePdf(3));
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(Buffer.isBuffer(part)).toBe(true);
      expect(await countPdfPages(part)).toBe(1);
    }
  });

  it('refuses more than MAX_SPLIT_PAGES', async () => {
    const huge = await makePdf(MAX_SPLIT_PAGES + 1);
    await expect(splitPdfToPages(huge)).rejects.toMatchObject({
      name: 'PdfSplitError',
      status: 400,
      code: 'PDF_TOO_MANY_PAGES',
    });
  });

  it('labels page filenames for the list', () => {
    expect(splitPageFilename('lot.pdf', 0, 6)).toBe('lot.pdf · pag. 1/6');
    expect(splitPageFilename('lot.pdf', 5, 6)).toBe('lot.pdf · pag. 6/6');
  });

  it('PdfSplitError carries an HTTP status', () => {
    const err = new PdfSplitError('x');
    expect(err.status).toBe(400);
  });
});
