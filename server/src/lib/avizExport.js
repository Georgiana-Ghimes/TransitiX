import ExcelJS from 'exceljs';
import { NUMERIC_SOURCES } from './avizTemplate.js';
import { canTotal, isNumericSource, numberFormatFor } from './reporting/sources.js';

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function numericColumn(col) {
  return NUMERIC_SOURCES.has(col.source)
    || NUMERIC_SOURCES.has(col.key)
    || isNumericSource(col.source);
}

function tpoKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function tpoColumnIndex(columns) {
  const idx = (columns || []).findIndex(
    (col) => col?.source === 'numar_tpo' || col?.key === 'numar_tpo',
  );
  return idx >= 0 ? idx + 1 : -1;
}

function rowTpoKey(row, columns, tpoColNumber) {
  const col = columns?.[tpoColNumber - 1];
  return tpoKey(row?.numar_tpo ?? (col ? row?.[col.key] : ''));
}

function dateSortKey(row, columns) {
  const dateCol = (columns || []).find(
    (col) => col?.source === 'data_efectuare_cursa' || col?.key === 'data_efectuare_cursa',
  );
  return String(
    row?.data_efectuare_cursa
    ?? (dateCol ? row?.[dateCol.key] : '')
    ?? '',
  );
}

/**
 * When „Unește celulele TPO” is on, pull every cursă with the same TPO together
 * (upload order alone leaves Baumit multi-trip TPOs scattered and only partially merged).
 * Empty TPO rows stay at the end; within a TPO group keep date then original index.
 */
export function groupRowsByTpoForMerge(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 2) return list;
  const tpoCol = tpoColumnIndex(columns);
  const indexed = list.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const ka = rowTpoKey(a.row, columns, tpoCol);
    const kb = rowTpoKey(b.row, columns, tpoCol);
    if (!ka && kb) return 1;
    if (ka && !kb) return -1;
    if (ka !== kb) return ka.localeCompare(kb, 'en');
    const da = dateSortKey(a.row, columns);
    const db = dateSortKey(b.row, columns);
    if (da !== db) return da.localeCompare(db, 'en');
    return a.index - b.index;
  });
  const nrCrtCol = (columns || []).find(
    (col) => col?.source === 'nr_crt' || col?.key === 'nr_crt',
  );
  return indexed.map((item, i) => {
    if (!nrCrtCol) return item.row;
    return { ...item.row, [nrCrtCol.key]: i + 1 };
  });
}

/**
 * Merge consecutive data rows that share the same TPO into one vertical cell
 * on the Număr TPO column (ExcelJS 1-based row/col; row 1 is the header).
 * Call after {@link groupRowsByTpoForMerge} so non-adjacent same-TPO curse become one block.
 */
export function mergeConsecutiveTpoCells(sheet, columns, rows) {
  const colNumber = tpoColumnIndex(columns);
  if (colNumber < 0 || !Array.isArray(rows) || rows.length < 2) return 0;

  let merges = 0;
  let runStart = 0;
  while (runStart < rows.length) {
    const key = rowTpoKey(rows[runStart], columns, colNumber);
    let runEnd = runStart + 1;
    if (key) {
      while (runEnd < rows.length) {
        const next = rowTpoKey(rows[runEnd], columns, colNumber);
        if (next !== key) break;
        runEnd += 1;
      }
    }
    if (key && runEnd - runStart > 1) {
      // Data starts at Excel row 2.
      const excelStart = runStart + 2;
      const excelEnd = runEnd + 1;
      sheet.mergeCells(excelStart, colNumber, excelEnd, colNumber);
      const cell = sheet.getCell(excelStart, colNumber);
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = THIN_BORDER;
      merges += 1;
    }
    runStart = key ? runEnd : runStart + 1;
  }
  return merges;
}

/**
 * Renders rows that have already been mapped.
 *
 * Re-downloading an old export goes through here with the rows stored at the time, so the file
 * a customer gets a second time is the file they got the first time, not a fresh reading of
 * documents that may have been corrected since.
 *
 * @param {{ mergeTpoCells?: boolean }} [opts]
 */
export function renderReportWorkbook({ name, columns, rows, totals = null, mergeTpoCells = false }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Transitix';
  const sheet = workbook.addWorksheet(String(name || 'Anexa').slice(0, 31));

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: Math.min(38, Math.max(16, String(col.header).length + 2)),
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 32;
  columns.forEach((col, idx) => {
    const cell = header.getCell(idx + 1);
    cell.value = col.header;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.border = THIN_BORDER;
  });

  const dataRows = mergeTpoCells
    ? groupRowsByTpoForMerge(rows, columns)
    : (Array.isArray(rows) ? rows : []);

  for (const row of dataRows) {
    const excelRow = sheet.addRow(columns.map((col) => row[col.key] ?? ''));
    excelRow.eachCell((cell, colNumber) => {
      const col = columns[colNumber - 1];
      if (col && numericColumn(col)) {
        const num = Number(cell.value);
        if (cell.value !== '' && !Number.isNaN(num)) {
          cell.value = num;
          cell.numFmt = numberFormatFor(col.source);
        }
      }
      cell.border = THIN_BORDER;
    });
  }

  if (mergeTpoCells) {
    mergeConsecutiveTpoCells(sheet, columns, dataRows);
  }

  if (totals && Object.keys(totals).length) {
    const values = columns.map((col) => (totals[col.key] ? totals[col.key].value : ''));
    const firstIdx = columns.findIndex((col) => !canTotal(col.source));
    if (firstIdx >= 0 && values[firstIdx] === '') values[firstIdx] = 'TOTAL';
    const totalRow = sheet.addRow(values);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNumber) => {
      const col = columns[colNumber - 1];
      if (col && totals[col.key]) cell.numFmt = numberFormatFor(col.source);
      cell.border = THIN_BORDER;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook;
}
