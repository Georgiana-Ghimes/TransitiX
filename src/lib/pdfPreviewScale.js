/**
 * Fit a PDF page to the preview pane's content width. The caller measures the box the
 * canvas actually sits in (padding already excluded). Scale stays between 0.5 and 2 so a
 * phone does not allocate a 3× bitmap for every page.
 *
 * @param {number} containerWidth
 * @param {number} pageWidth
 * @returns {number}
 */
export function pdfPageScale(containerWidth, pageWidth) {
  const available = Number(containerWidth);
  const width = Number(pageWidth);
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(width) || width <= 0) return 1;
  return Math.max(0.5, Math.min(2, available / width));
}
