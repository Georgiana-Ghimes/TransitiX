import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { readPdfRows, rowsFromTextItems } from './pdfRows.js';
import { extractGrossWeight, extractNetWeight, extractPalletCount } from './fields.js';
import { extractDocument } from './extract.js';

/** A pdf.js text item. y grows upwards, so a smaller y is further down the page. */
function item(str, x, y, { width, height = 10 } = {}) {
  return { str, width: width ?? str.length * height * 0.5, height, transform: [height, 0, 0, height, x, y] };
}

describe('rowsFromTextItems', () => {
  it('returns nothing for a page with no text layer', () => {
    expect(rowsFromTextItems([])).toBe('');
    expect(rowsFromTextItems(undefined)).toBe('');
    expect(rowsFromTextItems([item('   ', 10, 700)])).toBe('');
  });

  it('puts one visual row on one line, top of the page first', () => {
    const text = rowsFromTextItems([
      item('a doua', 60, 600),
      item('prima', 60, 700),
    ]);
    expect(text).toBe('prima\na doua');
  });

  it('separates columns with a tab and words with a space', () => {
    const text = rowsFromTextItems([
      item('Greutate', 60, 700),
      item('brută:', 106, 700),
      item('9.487,80', 400, 700),
    ]);
    expect(text).toBe('Greutate brută:\t9.487,80');
  });

  it('keeps a word split across two items as one word', () => {
    // Kerning pairs arrive as separate items that end and start at the same x.
    const text = rowsFromTextItems([
      item('Greu', 60, 700, { width: 20 }),
      item('tate', 80, 700, { width: 20 }),
    ]);
    expect(text).toBe('Greutate');
  });

  it('treats a baseline wobble inside a table row as the same row', () => {
    const text = rowsFromTextItems([
      item('Paleti:', 60, 700),
      item('18', 400, 698.4),
    ]);
    expect(text).toBe('Paleti:\t18');
  });

  it('keeps two real rows apart even when their cells interleave horizontally', () => {
    const text = rowsFromTextItems([
      item('jos-dreapta', 400, 680),
      item('sus-stanga', 60, 700),
      item('sus-dreapta', 400, 700),
      item('jos-stanga', 60, 680),
    ]);
    expect(text).toBe('sus-stanga\tsus-dreapta\njos-stanga\tjos-dreapta');
  });

  it('keeps text whose coordinates are unusable instead of dropping it', () => {
    const text = rowsFromTextItems([
      item('cu poziție', 60, 700),
      { str: 'fără poziție' },
    ]);
    expect(text).toContain('cu poziție');
    expect(text).toContain('fără poziție');
  });

  it('survives a generator that reports no width or height', () => {
    const text = rowsFromTextItems([
      { str: 'Total', transform: [0, 0, 0, 0, 60, 700] },
      { str: '9450', transform: [0, 0, 0, 0, 400, 700] },
    ]);
    expect(text).toBe('Total\t9450');
  });
});

/**
 * The reason this module exists. pdf-parse's own renderer split these cells onto separate
 * lines, so the weight matchers saw a label with nothing after it and the gross figure had to
 * be guessed from the bag count beside it.
 */
describe('a Baumit goods table, rebuilt', () => {
  const text = rowsFromTextItems([
    item('Cantitate', 60, 720),
    item('378,00', 200, 720),
    item('sac', 280, 720),
    item('Greutate netă:', 60, 700),
    item('9.450,00', 300, 700),
    item('kg', 380, 700),
    item('Greutate brută:', 60, 680),
    item('9.487,80', 300, 680),
    item('kg', 380, 680),
    item('Paleti:', 60, 660),
    item('18', 300, 660),
  ]);

  it('lands each label on the same line as its own figure', () => {
    expect(text.split('\n')[2]).toBe('Greutate brută:\t9.487,80\tkg');
  });

  it('reads the labelled gross weight at full confidence, not as a guess', () => {
    const gross = extractGrossWeight(text);
    expect(gross.value).toBe(9487.8);
    expect(gross.confidence).toBe(0.95);
  });

  it('reads the net weight and the pallet count off their own rows', () => {
    expect(extractNetWeight(text).value).toBe(9450);
    expect(extractPalletCount(text).value).toBe(18);
  });

  it('does not let a label reach into the column beside it', () => {
    // `Greutate brută:` printed with the figure missing and a neighbouring cell holding the
    // net weight: the gross must stay unmatched by the labelled pattern rather than claim it.
    const hollow = rowsFromTextItems([
      item('Greutate brută:', 60, 700),
      item('pce', 300, 700),
      item('Greutate netă:', 600, 700),
      item('9.450,00', 760, 700),
      item('kg', 840, 700),
    ]);
    expect(hollow).toBe('Greutate brută:\tpce\tGreutate netă:\t9.450,00\tkg');
    expect(extractNetWeight(hollow).value).toBe(9450);
  });
});

/**
 * A real PDF through pdf-parse, because the layout code is only worth as much as the item
 * shape pdf.js actually hands it: `transform`, `width` and `height` all have to be there and
 * mean what this module assumes. The fixture prints an aviz's fields in two columns, which is
 * how every Baumit PDF this system reads is laid out.
 */
describe('readPdfRows over a real PDF', () => {
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'aviz-coloane.pdf',
  );
  const pdf = readFileSync(fixture);

  /**
   * First read in the process, deliberately. `extract.js` is imported above, and while it
   * pulled in a second copy of pdf-parse through `createRequire`, the two copies of the
   * bundled pdf.js fought over its module global and this exact call threw `bad XRef entry`
   * on a file the next attempt read perfectly — so a PDF with a good text layer fell through
   * to a five-minute OCR for nothing.
   */
  it('reads a PDF on the first attempt, with the extractor loaded too', async () => {
    const { text, pages } = await readPdfRows(pdf);
    expect(pages).toBe(1);
    expect(text.split('\n').filter((line) => line.trim())).toHaveLength(7);
  });

  it('keeps each label beside its own figure, tab-separated', async () => {
    const { text } = await readPdfRows(pdf);
    expect(text).toContain('Greutate bruta:\t9.487,80\tkg');
    expect(text).toContain('Nr. auto\tB 330 SRS');
  });

  it('extracts both weights, the plate and the codes from it', async () => {
    const { text } = await readPdfRows(pdf);
    const extraction = extractDocument(text, { documentType: 'aviz' });
    expect(extraction.values.gross_weight_kg).toBe(9487.8);
    expect(extraction.values.net_weight_kg).toBe(9450);
    expect(extraction.values.numar_tpo).toBe('TPO-0025629');
    expect(extraction.values.numar_document_marfa).toBe('PSL-0044362');
    expect(extraction.values.numar_auto).toBe('B-330-SRS');
    expect(extraction.fields.gross_weight_kg.confidence).toBe(0.95);
  });

  /**
   * What the flat reader did to the same bytes. `Nr. autoB 330 SRS` has no word boundary in
   * front of the county letter, so the plate pattern could not see a plate at all — the field
   * came back empty on a PDF that prints it perfectly clearly.
   */
  it('finds the plate where pdf-parse default rendering glued it to its label', async () => {
    const { default: pdfParse } = await import('pdf-parse');
    const flat = String((await pdfParse(pdf))?.text ?? '');
    expect(flat).toContain('Nr. autoB 330 SRS');
    expect(extractDocument(flat, { documentType: 'aviz' }).values.numar_auto).toBeUndefined();

    const { text } = await readPdfRows(pdf);
    expect(extractDocument(text, { documentType: 'aviz' }).values.numar_auto).toBe('B-330-SRS');
  });
});
