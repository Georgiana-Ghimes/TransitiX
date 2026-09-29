/**
 * Drivers write carnet lines as "1. … 2. …" so OCR can map slot → field
 * even when the handwritten label is messy. See DRIVER_SHEET_GUIDE in the FE.
 */

/** Value after `N.` / `N)` / `N-` on its own line (or start of text). */
export function numberedLineValue(text, sheetNo) {
  const n = Number(sheetNo);
  if (!Number.isFinite(n) || n < 1) return '';
  const re = new RegExp(`(?:^|\\n)\\s*${n}[.)\\-]\\s*([^\\n]+)`, 'i');
  const m = String(text || '').match(re);
  return m ? String(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Prefer a numbered line; fall back to the classic extractor.
 * @param {number} sheetNo
 * @param {(text: string) => { value: unknown, confidence: number, matched?: string }} extract
 * @param {(raw: string) => { value: unknown, confidence: number, matched?: string } | null} [fromLine]
 */
export function withNumberedFallback(sheetNo, extract, fromLine) {
  return (text) => {
    const line = numberedLineValue(text, sheetNo);
    if (line) {
      if (typeof fromLine === 'function') {
        const parsed = fromLine(line);
        if (parsed?.value != null && parsed.value !== '') return parsed;
      }
      // Feed only the line into the classic extractor so labels on other lines do not confuse it.
      const fromExtract = extract(line);
      if (fromExtract?.value != null && fromExtract.value !== '') {
        return {
          ...fromExtract,
          confidence: Math.min(0.95, (Number(fromExtract.confidence) || 0.7) + 0.08),
          matched: fromExtract.matched || line,
        };
      }
    }
    return extract(text);
  };
}
