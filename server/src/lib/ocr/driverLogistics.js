/**
 * Same logistics contract as the driver app (`src/lib/driverAvizLogistics.js`).
 * Kept in server so confirm API does not import from the Vite tree.
 */

export const DRIVER_LOGISTICS_FIELDS = [
  { key: 'numar_tpo', label: 'Număr TPO', sheetNo: 1 },
  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', sheetNo: 2 },
  { key: 'numar_auto', label: 'Număr plăcuță auto', sheetNo: 4 },
  { key: 'ruta_transport', label: 'Rută transport', sheetNo: 5 },
  { key: 'tip_marfa', label: 'Tip marfă', sheetNo: 6 },
  { key: 'cantitate_marfa', label: 'Cantitate marfă (tone)', sheetNo: 7 },
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', sheetNo: 8 },
  { key: 'net_weight_kg', label: 'Greutate netă (kg)', sheetNo: 9 },
  { key: 'numar_document_marfa', label: 'Nr. document marfă (aviz/factură)', sheetNo: 10 },
  { key: 'numar_curse', label: 'Număr curse', sheetNo: 11 },
];

export const DRIVER_REQUIRED_KEYS = [
  'numar_tpo',
  'data_efectuare_cursa',
  'numar_auto',
];

export const DRIVER_REQUIRED_ONE_OF = ['cantitate_marfa', 'gross_weight_kg', 'net_weight_kg'];

export const DRIVER_WRITABLE_KEYS = DRIVER_LOGISTICS_FIELDS.map((f) => f.key);

export function fieldEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  return String(value).trim() === '';
}

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

export function pickLogisticsRow(doc = {}) {
  const out = {};
  for (const key of DRIVER_WRITABLE_KEYS) {
    out[key] = doc[key] ?? null;
  }
  return out;
}
