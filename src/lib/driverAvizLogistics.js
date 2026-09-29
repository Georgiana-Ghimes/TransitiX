/**
 * Logistics fields the driver must complete after photo OCR (not finance annex fields).
 * Shared contract: driver app form + confirm API + writing cheat-sheet numbers.
 */

export const DRIVER_LOGISTICS_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO', sheetNo: 1, type: 'text' },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', sheetNo: 2, type: 'date' },
  { key: 'numar_auto', label: 'Număr auto', sheetNo: 3, type: 'text' },
  { key: 'ruta_transport', label: 'Rută transport', sheetNo: 4, type: 'text' },
  { key: 'tip_marfa', label: 'Tip marfă', sheetNo: 5, type: 'text' },
  { key: 'cantitate_marfa', label: 'Cantitate marfă', sheetNo: 6, type: 'number' },
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', sheetNo: 6, type: 'number' },
  { key: 'numar_document_marfa', label: 'Nr. document marfă (PSL/TRO)', sheetNo: 7, type: 'text' },
  { key: 'numar_curse', label: 'Număr curse', sheetNo: 8, type: 'number' },
];

/** Must be filled before the driver can mark the upload complete. */
export const DRIVER_REQUIRED_KEYS = [
  'numar_tpo',
  'data_efectuare_cursa',
  'numar_auto',
];

/** At least one of these must be present (weight or quantity). */
export const DRIVER_REQUIRED_ONE_OF = ['cantitate_marfa', 'gross_weight_kg'];

export const DRIVER_SHEET_GUIDE = [
  { no: 1, hint: 'TPO (ex: TPO-0025813)' },
  { no: 2, hint: 'DATA (zz.ll.aaaa)' },
  { no: 3, hint: 'NR AUTO (ex: B 112 VFM)' },
  { no: 4, hint: 'RUTA' },
  { no: 5, hint: 'TIP MARFĂ' },
  { no: 6, hint: 'CANTITATE / GREUTATE BRUTĂ' },
  { no: 7, hint: 'NR DOCUMENT (PSL/TRO)' },
  { no: 8, hint: 'NR CURSE' },
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
      label: 'Cantitate marfă sau greutate brută',
    });
  }
  return missing;
}

export function driverLogisticsComplete(row = {}) {
  return missingDriverLogistics(row).length === 0;
}

/** Keys the confirm API may write. */
export const DRIVER_WRITABLE_KEYS = DRIVER_LOGISTICS_FIELDS.map((f) => f.key);
