import ExcelJS from 'exceljs';
import { NUMERIC_SOURCES } from './avizTemplate.js';
import { canTotal, numberFormatFor } from './reporting/sources.js';

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function numericColumn(col) {
  return NUMERIC_SOURCES.has(col.source) || NUMERIC_SOURCES.has(col.key);
}

/**
 * Renders rows that have already been mapped.
 *
 * Re-downloading an old export goes through here with the rows stored at the time, so the file
 * a customer gets a second time is the file they got the first time — not a fresh reading of
 * documents that may have been corrected since.
 */
export function renderReportWorkbook({ name, columns, rows, totals = null }) {
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

  for (const row of rows) {
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
