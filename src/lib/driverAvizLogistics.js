/**
 * Logistics fields the driver must complete after photo OCR (not finance annex fields).
 * Shared contract: driver app form + confirm API + writing cheat-sheet numbers.
 *
 * `sheetNo` mirrors DRIVER_SHEET_GUIDE so the form and the handwritten checklist stay aligned.
 * Gaps (3 = valoare TPO, 12–14 = taxe/km/tarif) are annex fields the office often fills - they
 * stay on the paper guide so handwriting OCR can still pick them up when the driver wrote them.
 */

export const DRIVER_LOGISTICS_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO', sheetNo: 1, type: 'text' },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', sheetNo: 2, type: 'date' },
  { key: 'numar_auto', label: 'Număr plăcuță auto', sheetNo: 4, type: 'text' },
  { key: 'ruta_transport', label: 'Rută transport', sheetNo: 5, type: 'text' },
  { key: 'tip_marfa', label: 'Tip marfă', sheetNo: 6, type: 'text' },
  { key: 'cantitate_marfa', label: 'Cantitate marfă (tone)', sheetNo: 7, type: 'number' },
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', sheetNo: 8, type: 'number' },
  { key: 'net_weight_kg', label: 'Greutate netă (kg)', sheetNo: 9, type: 'number' },
  { key: 'numar_document_marfa', label: 'Nr. document marfă (aviz/factură)', sheetNo: 10, type: 'text' },
  { key: 'numar_curse', label: 'Număr curse', sheetNo: 11, type: 'text' },
];

/** Must be filled before the driver can mark the upload complete. */
export const DRIVER_REQUIRED_KEYS = [
  'numar_tpo',
  'data_efectuare_cursa',
  'numar_auto',
];

/** At least one of these must be present (weight or quantity). */
export const DRIVER_REQUIRED_ONE_OF = ['cantitate_marfa', 'gross_weight_kg', 'net_weight_kg'];

/**
 * What to write on a blank sheet, in order, before photographing it.
 * Numbers stay fixed - OCR (`DRIVER_SHEET_FIELD_BY_NO` / carnet_bord) and the office expect
 * this layout. Optional annex fields are marked so a driver who does not know the figure
 * leaves the line blank instead of inventing one.
 */
export const DRIVER_SHEET_GUIDE = [
  { no: 1, hint: 'TPO' },
  { no: 2, hint: 'Data efectuare cursă' },
  { no: 3, hint: 'Valoare TPO (lăsați gol dacă este cazul)' },
  { no: 4, hint: 'Număr plăcuță auto' },
  { no: 5, hint: 'Rută transport' },
  { no: 6, hint: 'Tip marfă' },
  { no: 7, hint: 'Cantitate marfă (tone)' },
  { no: 8, hint: 'Greutate brută (kg)' },
  { no: 9, hint: 'Greutate netă (kg)' },
  { no: 10, hint: 'Număr document marfă (aviz/factură)' },
  { no: 11, hint: 'Număr curse' },
  { no: 12, hint: 'Taxe suplimentare (dacă este cazul)' },
  { no: 13, hint: 'Km parcurși (dacă este cazul)' },
  { no: 14, hint: 'Tarif km (dacă este cazul)' },
];

export function fieldEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  return String(value).trim() === '';
}

/**
 * @param {Record<string, unknown>} row column values (or form state)
 * @returns {{ key: string, label: string }[]}
 */
export function missingDriverLogistics(row = {}) {
  const missing = [];
  for (const key of DRIVER_REQUIRED_KEYS) {
    if (fieldEmpty(row[key])) {
      const meta = DRIVER_LOGISTICS_FIELDS.find((f) => f.key === key);
      missing.push({ key, label: meta?.label || key });
    }
  }
  const hasQtyOrWeight = DRIVER_REQUIRED_ONE_OF.some((k) => !fieldEmpty(row[k]));
  if (!hasQtyOrWeight) {
    missing.push({
      key: 'cantitate_sau_greutate',
      label: 'Cantitate marfă sau greutate',
    });
  }
  return missing;
}

export function driverLogisticsComplete(row = {}) {
  return missingDriverLogistics(row).length === 0;
}

/** Keys the confirm API may write. */
export const DRIVER_WRITABLE_KEYS = DRIVER_LOGISTICS_FIELDS.map((f) => f.key);
