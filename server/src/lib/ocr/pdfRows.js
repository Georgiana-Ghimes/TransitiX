/**
 * PDF text layer with the page's columns kept.
 *
 * pdf-parse's own renderer walks the text items in storage order and starts a new line only
 * when `transform[5]` differs *exactly*, concatenating everything else with no separator at
 * all. On a table that is wrong twice over: two cells a hair apart vertically become two
 * lines, and a label and the figure beside it become one word.
 *
 * That is what hid the Baumit gross weight. The page reads
 *
 *   Greutate brută:   9.487,80   kg
 *
 * as three cells on one row, and every weight / quantity / pallet matcher in `fields.js` looks
 * for the label and the number on the same line. Rebuilding the rows from the coordinates puts
 * them back there, which is why a labelled weight can be trusted at 0.95 instead of being
 * guessed at 0.8 from whatever else on the page was measured in kilograms.
 *
 * A tab means "next column", a space means "next word in this cell". Both are `\s`, so the
 * label patterns match across either, while the capture classes that stop at `\t` cannot run
 * off the end of a cell and swallow the column next to it.
 */

/** Column break. Anything wider than this many line-heights is a different cell. */
const COLUMN_GAP = 1.2;
/** Word break. Below this the two items are pieces of one word (kerning, ligatures). */
const WORD_GAP = 0.12;

function normalizeItems(items) {
  const cells = [];
  // Text a generator gave no usable coordinates for. Kept on its own line rather than dropped:
  // a wasted line costs nothing, a missing figure is the number that ends up on an invoice.
  const loose = [];
  for (const item of Array.isArray(items) ? items : []) {
    const str = String(item?.str ?? '');
    if (!str.trim()) continue;
    const t = Array.isArray(item?.transform) ? item.transform : null;
    const x = Number(item?.x ?? (t ? t[4] : NaN));
    const y = Number(item?.y ?? (t ? t[5] : NaN));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      loose.push(str.trim());
      continue;
    }
    // `height` is absent on some generators; the vertical scale in the matrix is the same
    // number, and a default only has to be in the right order of magnitude for the gap ratios.
    const height = Math.abs(Number(item?.height ?? (t ? t[3] : 0))) || 10;
    const width = Math.abs(Number(item?.width ?? 0)) || str.length * height * 0.5;
    cells.push({ str, x, y, width, height });
  }
  return { cells, loose };
}

function medianHeight(cells) {
  const sorted = cells.map((c) => c.height).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function joinRow(cells, fallbackHeight) {
  const ordered = [...cells].sort((a, b) => a.x - b.x);
  let out = ordered[0].str;
  // Where the text so far ends. `max` because a wide cell may overlap the next one's start.
  let cursor = ordered[0].x + ordered[0].width;

  for (let i = 1; i < ordered.length; i += 1) {
    const cell = ordered[i];
    const height = cell.height || fallbackHeight;
    const gap = cell.x - cursor;
    if (gap > height * COLUMN_GAP) out += '\t';
    else if (gap > height * WORD_GAP && !/\s$/.test(out) && !/^\s/.test(cell.str)) out += ' ';
    out += cell.str;
    cursor = Math.max(cursor, cell.x + cell.width);
  }
  return out.replace(/[ \t]+$/, '');
}

/**
 * One line of text per visual row of the page.
 *
 * @param {Array<{str: string, transform?: number[], x?: number, y?: number,
 *   width?: number, height?: number}>} items  pdf.js text items
 * @returns {string}
 */
export function rowsFromTextItems(items) {
  const { cells, loose } = normalizeItems(items);
  if (!cells.length) return loose.join('\n').trim();

  const fallbackHeight = medianHeight(cells);
  // Half a line-height: enough for the baseline wobble of a cell in a table row, not enough to
  // merge two real rows, which sit a full line-height apart.
  const tolerance = Math.max(0.5, fallbackHeight * 0.5);

  // Top of the page first (PDF y grows upwards), then left to right.
  const sorted = [...cells].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  for (const cell of sorted) {
    // Compared against the row's first cell, not a running mean: a long row of slightly
    // drifting baselines would otherwise creep into the row below it.
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.anchorY - cell.y) <= tolerance) row.cells.push(cell);
    else rows.push({ anchorY: cell.y, cells: [cell] });
  }

  const lines = rows.map((row) => joinRow(row.cells, fallbackHeight));
  return [...lines, ...loose].join('\n');
}

let loading = null;

/**
 * The one place pdf-parse is loaded.
 *
 * It used to be loaded twice — here and through `createRequire` in avizOcr.js — and the bundled
 * pdf.js keeps state on a module global. Two copies of it fought over that global and the first
 * PDF read after boot threw `bad XRef entry` on a file the second attempt parsed perfectly.
 * That is what the retry loop in avizOcr.js was working around.
 */
function pdfParser() {
  if (!loading) loading = import('pdf-parse').then((mod) => mod.default ?? mod);
  return loading;
}

/**
 * pdf-parse over a private copy of the bytes, retried.
 *
 * The copy is not superstition: pdf.js takes ownership of the buffer it is handed, so a caller
 * that reads the same file twice (text layer, then a hash for the cache) must not share one.
 *
 * @param {Buffer} buffer
 * @param {object} [options]  passed through to pdf-parse, e.g. `pagerender`
 */
export async function parsePdf(buffer, options) {
  const parse = await pdfParser();
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await parse(Buffer.from(buffer), options);
    } catch (err) {
      lastErr = err;
      console.warn(`[ocr] pdf-parse attempt ${attempt + 1}: ${err?.message || err}`);
    }
  }
  throw lastErr;
}

/**
 * Reads a PDF's text layer, rows preserved.
 *
 * @returns {Promise<{text: string, pages: number}>}
 */
export async function readPdfRows(buffer) {
  const parsed = await parsePdf(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      return rowsFromTextItems(content?.items);
    },
  });
  return { text: String(parsed?.text ?? ''), pages: Number(parsed?.numpages) || 0 };
}
