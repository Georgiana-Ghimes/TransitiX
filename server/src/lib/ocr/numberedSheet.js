/**
 * Drivers write carnet lines as "1. … 2. …" so OCR can map slot → field
 * even when the handwritten label is messy or missing. Must stay aligned with
 * DRIVER_SHEET_GUIDE in `src/lib/driverAvizLogistics.js` (same numbers, same order).
 */

/**
 * Sheet slot → extractor field name (see DRIVER_SHEET_GUIDE nos 1–14).
 * `quantity` maps to `cantitate_marfa` in toColumns.
 */
export const DRIVER_SHEET_FIELD_BY_NO = Object.freeze({
  1: 'numar_tpo',
  2: 'data_efectuare_cursa',
  3: 'valoare_tpo',
  4: 'numar_auto',
  5: 'ruta_transport',
  6: 'tip_marfa',
  7: 'quantity',
  8: 'gross_weight_kg',
  9: 'net_weight_kg',
  10: 'numar_document_marfa',
  11: 'numar_curse',
  12: 'taxe_suplimentare',
  13: 'km_parcursi',
  14: 'tarif_km',
});

/** Value after `N.` / `N)` / `N-` on its own line (or start of text). */
export function numberedLineValue(text, sheetNo) {
  const n = Number(sheetNo);
  if (!Number.isFinite(n) || n < 1) return '';
  // Same-line whitespace only after the marker: `\s*` would jump to the next numbered
  // line and turn a blank "3." into the plate digits from "4. B …".
  const re = new RegExp(`(?:^|\\n)\\s*${n}[.)\\-][^\\S\\n]*([^\\n]*)`, 'i');
  const m = String(text || '').match(re);
  if (!m) return '';
  const raw = String(m[1]).replace(/\s+/g, ' ').trim();
  // Drivers leave optional lines blank as "3." / "3. -" / "3. gol" — treat as empty.
  if (!raw || /^(?:[-–—x]|gol|n\/?a|\.+)$/i.test(raw)) return '';
  return raw;
}

/** How many DRIVER_SHEET_GUIDE slots (1–14) carry a non-blank value. */
export function countFilledSheetSlots(text) {
  let filled = 0;
  for (let n = 1; n <= 14; n += 1) {
    if (numberedLineValue(text, n)) filled += 1;
  }
  return filled;
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
