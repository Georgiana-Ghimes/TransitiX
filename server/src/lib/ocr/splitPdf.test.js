import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  MAX_SPLIT_PAGES,
  PdfSplitError,
  avizDocumentKeys,
  countPdfPages,
  planAvizPdfSplits,
  splitAvizFilename,
  splitPageFilename,
  splitPdfByGroups,
  splitPdfToPages,
} from './splitPdf.js';

async function makePdf(pageCount, { labelForPage } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([400, 200]);
    const label = labelForPage ? labelForPage(i) : `Aviz page ${i + 1}`;
    page.drawText(label, { x: 40, y: 100, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

describe('avizDocumentKeys / planAvizPdfSplits', () => {
  it('reads TRO and PSL keys', () => {
    expect([...avizDocumentKeys('Aviz TRO-0009884 and TRO 0009884')]).toEqual(['TRO-0009884']);
    expect([...avizDocumentKeys('PSL_12345 here')]).toEqual(['PSL-12345']);
    expect(avizDocumentKeys('only TPO-31027').size).toBe(0);
  });

  it('keeps a multi-page single aviz together (one TRO, or TRO only on page 1)', () => {
    expect(planAvizPdfSplits([
      'Expeditor TRO-0009884 page 1',
      'continuation lines greutate',
    ])).toBeNull();
    expect(planAvizPdfSplits([
      'TRO-0009884 header',
      'TRO-0009884 reprinted on page 2',
    ])).toBeNull();
    expect(planAvizPdfSplits(['no codes', 'still none'])).toBeNull();
  });

  it('splits when distinct TRO/PSL numbers appear on different pages', () => {
    expect(planAvizPdfSplits([
      'Aviz TRO-0001001',
      'Aviz TRO-0001002',
      'Aviz TRO-0001003',
    ])).toEqual([[0], [1], [2]]);
  });

  it('keeps continuation pages with the preceding aviz', () => {
    expect(planAvizPdfSplits([
      'TRO-0001001 header',
      'product lines only',
      'TRO-0001002 next aviz',
    ])).toEqual([[0, 1], [2]]);
  });
});

describe('splitPdf', () => {
  it('counts pages', async () => {
    expect(await countPdfPages(await makePdf(3))).toBe(3);
  });

  it('splits into one buffer per page (low-level)', async () => {
    const parts = await splitPdfToPages(await makePdf(3));
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(Buffer.isBuffer(part)).toBe(true);
      expect(await countPdfPages(part)).toBe(1);
    }
  });

  it('merges page groups into multi-page parts', async () => {
    const src = await makePdf(3, {
      labelForPage: (i) => (i < 2 ? 'TRO-0001001' : 'TRO-0001002'),
    });
    const parts = await splitPdfByGroups(src, [[0, 1], [2]]);
    expect(parts).toHaveLength(2);
    expect(await countPdfPages(parts[0])).toBe(2);
    expect(await countPdfPages(parts[1])).toBe(1);
  });

  it('refuses more than MAX_SPLIT_PAGES', async () => {
    const huge = await makePdf(MAX_SPLIT_PAGES + 1);
    await expect(splitPdfToPages(huge)).rejects.toMatchObject({
      name: 'PdfSplitError',
      status: 400,
      code: 'PDF_TOO_MANY_PAGES',
    });
  });

  it('labels part filenames for the list', () => {
    expect(splitPageFilename('lot.pdf', 0, 6)).toBe('lot.pdf · pag. 1/6');
    expect(splitPageFilename('lot.pdf', 5, 6)).toBe('lot.pdf · pag. 6/6');
    expect(splitAvizFilename('lot.pdf', 0, 2)).toBe('lot.pdf · aviz 1/2');
  });

  it('PdfSplitError carries an HTTP status', () => {
    const err = new PdfSplitError('x');
    expect(err.status).toBe(400);
  });
});
