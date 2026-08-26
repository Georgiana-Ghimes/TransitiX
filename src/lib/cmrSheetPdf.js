/**
 * Renders a consignment note to a downloadable PDF.
 *
 * Same approach as the road sheet: the page is built as HTML and rasterized rather than drawn
 * with jsPDF's text API, because the standard PDF fonts cannot encode `ș`, `ț` and `ă`. An image
 * of correct text beats selectable text that is wrong — on a document a driver may have to hand
 * to an inspector, a misspelled consignee is not a cosmetic problem.
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { PAGE, cmrSheetFilename, cmrSheetHtml } from './cmrSheetHtml.js';
import { fetchUploadBlob } from './uploadUrl.js';

const SCALE = 2;

function readAsDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Signatures as data URLs.
 *
 * The rasterizer clones the document and loads images itself, with no chance to set an
 * Authorization header, and `/uploads` is protected. Fetching them first and inlining is the
 * only way the signatures reach the page — and a signature that silently failed to load would
 * turn a signed note into one that prints blank.
 */
async function inlineSignatures(signatures = {}) {
  const entries = await Promise.all(
    Object.entries(signatures).map(async ([key, url]) => {
      if (typeof url !== 'string' || !url.startsWith('/uploads/')) return [key, url];
      try {
        const blob = await fetchUploadBlob(url);
        return [key, blob ? await readAsDataUrl(blob) : null];
      } catch {
        return [key, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Builds the PDF and hands it to the browser.
 *
 * @param {object} model the `/api/cmr/trips/:id` payload
 * @returns {Promise<{ missingSignatures: string[] }>} which signatures could not be loaded, so
 *   the caller can say so rather than let a blank box pass for an unsigned one
 */
export async function downloadCmrSheet(model) {
  const inlined = await inlineSignatures(model?.signatures);
  const missingSignatures = Object.entries(model?.signatures ?? {})
    .filter(([key, url]) => url && !inlined[key])
    .map(([key]) => key);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  // Absolute and off to the left: the rasterizer clones the document, so the page must lay out
  // identically in the clone. A negative offset also cannot add a scrollbar.
  host.style.cssText = `position:absolute;left:-20000px;top:0;width:${PAGE.width}px;background:#fff;`;
  document.body.appendChild(host);

  try {
    host.innerHTML = cmrSheetHtml({ ...model, signatures: inlined });
    const canvas = await html2canvas(host.firstElementChild, {
      scale: SCALE,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: PAGE.width,
      windowHeight: PAGE.height,
    });
    if (!canvas.width || !canvas.height) throw new Error('Pagina nu a putut fi randată');

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const drawn = Math.min(height, (canvas.height / canvas.width) * width);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, width, drawn);
    pdf.save(cmrSheetFilename(model));

    return { missingSignatures };
  } finally {
    host.remove();
  }
}
