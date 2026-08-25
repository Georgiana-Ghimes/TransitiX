/**
 * Renders a road sheet to a downloadable PDF.
 *
 * The page is built as HTML and rasterized, rather than drawn with jsPDF's text API,
 * because the standard PDF fonts cannot encode `ș`, `ț` and `ă` — a vector sheet would
 * misspell half the Romanian on every line. An image of correct text beats selectable text
 * that is wrong.
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { paginateSheetRows } from './routeSheet.js';
import { PAGE, sheetPageHtml } from './routeSheetHtml.js';

const SCALE = 2;

/**
 * Builds the PDF and hands it to the browser.
 *
 * Each page is rasterized on its own, so a stop never straddles two sheets of paper.
 */
export async function downloadRouteSheet(sheet) {
  const pages = paginateSheetRows(sheet.rows);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // Absolute and off to the left: the rasterizer clones the document, so the page must lay
  // out identically in the clone. A negative offset also cannot add a scrollbar.
  host.style.cssText = `position:absolute;left:-20000px;top:0;width:${PAGE.width}px;background:#fff;`;
  document.body.appendChild(host);

  try {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();

    for (let index = 0; index < pages.length; index += 1) {
      host.innerHTML = sheetPageHtml(sheet, pages[index], index, pages.length);
      const canvas = await html2canvas(host.firstElementChild, {
        scale: SCALE,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: PAGE.width,
        windowHeight: PAGE.height,
      });
      if (!canvas.width || !canvas.height) {
        throw new Error('Pagina nu a putut fi randată');
      }
      if (index > 0) pdf.addPage('a4', 'landscape');
      // Height follows the canvas so a short sheet is not stretched down the page.
      const drawn = Math.min(height, (canvas.height / canvas.width) * width);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, drawn);
    }

    pdf.save(sheet.filename);
  } finally {
    host.remove();
  }
}
