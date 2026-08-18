import ExcelJS from 'exceljs';
import { mapAnnexRows, resolveExportColumns, NUMERIC_SOURCES } from './avizTemplate.js';

const NUMBER_FORMAT = {
  nr_crt: '0',
  valoare_tpo: '#,##0.00',
  cantitate_marfa: '#,##0.00',
  numar_curse: '0',
  taxe_suplimentare: '#,##0.00',
  km_parcursi: '#,##0.00',
  tarif_km: '#,##0.0000',
};

export async function buildAnnexWorkbook(template, avize) {
  const columns = resolveExportColumns(template);
  const rows = mapAnnexRows(columns, avize);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Transitix';
  const sheet = workbook.addWorksheet(String(template.name || 'Anexa').slice(0, 31));

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
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFF00' },
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  for (const row of rows) {
    const excelRow = sheet.addRow(columns.map((col) => row[col.key] ?? ''));
    excelRow.eachCell((cell, colNumber) => {
      const col = columns[colNumber - 1];
      const source = col?.source;
      if (NUMERIC_SOURCES.has(source)) {
        const num = Number(cell.value);
        if (cell.value !== '' && !Number.isNaN(num)) {
          cell.value = num;
          cell.numFmt = NUMBER_FORMAT[source] || '#,##0.00';
        }
      }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook;
}
