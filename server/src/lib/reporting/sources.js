/**
 * The vocabulary a report template may draw on.
 *
 * Before this registry the column list was a bare array of key names, so the template builder
 * had nothing to show an operator beyond the key itself, and the exporter had to guess how to
 * format a cell. Each source now carries its own label, type and number format, which means a
 * new reportable field is one entry here rather than edits in three files.
 */

/**
 * `total` says what a column footer may legitimately do.
 *
 * `sum` is only for quantities that add up across trips. A rate never does: adding the per-km
 * tariff of ten trips produces a number that looks like money and means nothing, and a customer
 * receiving that sheet has no way to tell. Rates are therefore explicitly `none`.
 */
export const REPORT_SOURCES = [
  { key: 'nr_crt', label: 'Nr. crt', group: 'identificare', type: 'integer', numFmt: '0', total: 'none', computed: true },
  { key: 'numar_tpo', label: 'Număr TPO', group: 'identificare', type: 'text', total: 'none' },
  { key: 'numar_document_marfa', label: 'Număr document marfă (aviz/factură)', group: 'identificare', type: 'text', total: 'none' },
  { key: 'original_filename', label: 'Fișier sursă', group: 'identificare', type: 'text', total: 'none' },

  { key: 'data_efectuare_cursa', label: 'Data efectuare cursă', group: 'cursa', type: 'date', total: 'none' },
  { key: 'numar_auto', label: 'Număr auto', group: 'cursa', type: 'text', total: 'none' },
  { key: 'ruta_transport', label: 'Rută transport', group: 'cursa', type: 'text', total: 'none' },
  { key: 'numar_curse', label: 'Număr curse', group: 'cursa', type: 'integer', numFmt: '0', total: 'sum' },
  { key: 'km_parcursi', label: 'Km parcurși', group: 'cursa', type: 'number', numFmt: '#,##0.00', total: 'sum' },

  { key: 'tip_marfa', label: 'Tip marfă', group: 'marfa', type: 'text', total: 'none' },
  { key: 'cantitate_marfa', label: 'Cantitate marfă', group: 'marfa', type: 'number', numFmt: '#,##0.00', total: 'sum' },
  { key: 'quantity_unit', label: 'Unitate cantitate', group: 'marfa', type: 'text', total: 'none' },
  { key: 'pallets', label: 'Paleți', group: 'marfa', type: 'integer', numFmt: '0', total: 'sum' },

  // The figure the weighbridge shows, goods plus pallets. This is what the client asked the
  // report to carry instead of "378 saci" — a sack count cannot be checked against a weighing.
  { key: 'gross_weight_kg', label: 'Greutate brută (kg)', group: 'greutate', type: 'weight', numFmt: '#,##0', total: 'sum' },
  { key: 'net_weight_kg', label: 'Greutate netă (kg)', group: 'greutate', type: 'weight', numFmt: '#,##0', total: 'sum' },
  { key: 'pallet_weight_kg', label: 'Greutate paleți (kg)', group: 'greutate', type: 'weight', numFmt: '#,##0', total: 'sum' },

  // The date the line is billed on. Deliberately separate from `data_efectuare_cursa`: a tariff
  // is always read as of the day the trip ran, never the day the invoice went out, and putting
  // the two under one column would make a rate change mid-month unauditable.
  { key: 'data_facturare', label: 'Dată facturare', group: 'comercial', type: 'date', total: 'none' },
  { key: 'valoare_tpo', label: 'Valoare TPO', group: 'comercial', type: 'money', numFmt: '#,##0.00', total: 'sum' },
  { key: 'taxe_suplimentare', label: 'Taxe suplimentare', group: 'comercial', type: 'money', numFmt: '#,##0.00', total: 'sum' },
  { key: 'tarif_km', label: 'Tarif km', group: 'comercial', type: 'number', numFmt: '#,##0.0000', total: 'none' },

  { key: 'observatii', label: 'Observații', group: 'meta', type: 'text', total: 'none' },
  { key: 'status', label: 'Status document', group: 'meta', type: 'text', total: 'none' },
];

export const SOURCE_GROUPS = [
  { id: 'identificare', label: 'Identificare' },
  { id: 'cursa', label: 'Cursă' },
  { id: 'marfa', label: 'Marfă' },
  { id: 'greutate', label: 'Greutate' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'meta', label: 'Altele' },
];

const BY_KEY = new Map(REPORT_SOURCES.map((s) => [s.key, s]));

export function getSource(key) {
  return BY_KEY.get(String(key || '')) || null;
}

export function isNumericSource(key) {
  const source = getSource(key);
  return Boolean(source) && ['number', 'integer', 'money', 'weight'].includes(source.type);
}

export function canTotal(key) {
  return getSource(key)?.total === 'sum';
}

/** Every source that reports a weighed figure, whatever the template chose to call the column. */
export const WEIGHT_SOURCES = REPORT_SOURCES.filter((s) => s.type === 'weight').map((s) => s.key);

export function numberFormatFor(key) {
  return getSource(key)?.numFmt || '#,##0.00';
}
