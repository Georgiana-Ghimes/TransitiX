import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  MAX_SPLIT_PAGES,
  PdfSplitError,
  avizDocumentKeys,
  avizSplitKeysForPage,
  avizTpoKeys,
  ocrIdDigits,
  countPdfPages,
  planAvizPdfSplits,
  readPdfPageTexts,
  safeDownloadFilename,
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

  it('#108 reads TRO when OCR wrote O/I instead of 0/1 (Baumit text layer)', () => {
    expect(ocrIdDigits('OOI 1300')).toBe('0011300');
    expect([...avizDocumentKeys('Aviz de expeditie TRO-OOI 1300')]).toEqual(['TRO-0011300']);
    expect([...avizDocumentKeys('TRO-OOI 1335 Comanda')]).toEqual(['TRO-0011335']);
    expect([...avizDocumentKeys('TRO-OOI1300')]).toEqual(['TRO-0011300']);
  });

  it('#108 also uses TPO keys (TRO often mangled on Baumit text layer)', () => {
    expect([...avizSplitKeysForPage('rezumat: TPO-0035189 only')]).toEqual(['TPO-0035189']);
    expect([...avizTpoKeys('T PO-0035189')]).toEqual(['TPO-0035189']);
    expect([...avizSplitKeysForPage('TRO-0011300 TPO-0035189')].sort()).toEqual([
      'TPO-0035189', 'TRO-0011300',
    ]);
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

  it('#108 splits Baumit pages that only have TRO-OOI… in the text layer', () => {
    expect(planAvizPdfSplits([
      'rezumat: TPO-0035189\nAviz de expeditie TRO-OOI 1300',
      'rezumat: TPO-0035299\nAviz de expeditie TRO-OOI 1335',
    ])).toEqual([[0], [1]]);
  });

  it('#108 keeps same-TPO continuation when TRO is only on page 1', () => {
    expect(planAvizPdfSplits([
      'TPO-0035189 TRO-0011300 header',
      'TPO-0035189 greutate continuation',
    ])).toBeNull();
  });
});

describe('jsPDF text layer (same generator as avize.api tests)', () => {
  it('reads distinct TRO labels so a bulk PDF still splits', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    doc.text('Aviz TRO-1001000', 10, 10);
    doc.addPage();
    doc.text('Aviz TRO-1001001', 10, 10);
    const buf = Buffer.from(doc.output(), 'latin1');
    const texts = await readPdfPageTexts(buf);
    expect(planAvizPdfSplits(texts)).toEqual([[0], [1]]);
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
    expect(splitAvizFilename('lot.pdf', 5, 28, { pageFrom: 6, pageTo: 7 }))
      .toBe('lot.pdf · aviz 6/28 · pag. 6–7');
  });

  it('#105 download / zip names put the extension last', () => {
    expect(safeDownloadFilename('21.10.BAU.pdf · aviz 4/13 · pag. 6'))
      .toBe('21.10.BAU-aviz-4-13-pag-6.pdf');
    expect(safeDownloadFilename(splitAvizFilename('lot.pdf', 5, 28, { pageFrom: 6, pageTo: 7 })))
      .toBe('lot-aviz-6-28-pag-6-7.pdf');
  });

  it('PdfSplitError carries an HTTP status', () => {
    const err = new PdfSplitError('x');
    expect(err.status).toBe(400);
  });
});
