/** Anexa Factura RAI column map (A–N on the model sheet). */

export const ANNEX_SOURCE_KEYS = [
  'nr_crt',
  'numar_tpo',
  'data_efectuare_cursa',
  'valoare_tpo',
  'numar_auto',
  'ruta_transport',
  'tip_marfa',
  'cantitate_marfa',
  'numar_document_marfa',
  'numar_curse',
  'taxe_suplimentare',
  'km_parcursi',
  'tarif_km',
  'observatii',
];

export const NUMERIC_SOURCES = new Set([
  'nr_crt',
  'valoare_tpo',
  'cantitate_marfa',
  'numar_curse',
  'taxe_suplimentare',
  'km_parcursi',
  'tarif_km',
]);

export const DEFAULT_RAI_COLUMNS = [
  { key: 'nr_crt', header: 'Nr. crt', source: 'nr_crt', default_value: '' },
  { key: 'numar_tpo', header: 'Numar TPO', source: 'numar_tpo', default_value: '' },
  { key: 'data_efectuare_cursa', header: 'Data efectuare cursa', source: 'data_efectuare_cursa', default_value: '' },
  { key: 'valoare_tpo', header: 'Valoare TPO', source: 'valoare_tpo', default_value: 0 },
  { key: 'numar_auto', header: 'Numar auto', source: 'numar_auto', default_value: '' },
  { key: 'ruta_transport', header: 'Ruta transport', source: 'ruta_transport', default_value: '' },
  { key: 'tip_marfa', header: 'Tip marfa', source: 'tip_marfa', default_value: '' },
  { key: 'cantitate_marfa', header: 'Cantitate marfa (t/m3/galeti)', source: 'cantitate_marfa', default_value: '' },
  { key: 'numar_document_marfa', header: 'Numar document marfa (aviz/factura)', source: 'numar_document_marfa', default_value: '' },
  { key: 'numar_curse', header: 'Numar curse', source: 'numar_curse', default_value: 1 },
  { key: 'taxe_suplimentare', header: 'Taxa suplimentara', source: 'taxe_suplimentare', default_value: 0 },
  { key: 'km_parcursi', header: 'Km parcursi', source: 'km_parcursi', default_value: 0 },
  { key: 'tarif_km', header: 'Tarif km', source: 'tarif_km', default_value: 0 },
  { key: 'observatii', header: 'Observatii', source: 'observatii', default_value: '' },
];

export function annexFieldDefaults() {
  return {
    numar_tpo: null,
    data_efectuare_cursa: null,
    valoare_tpo: 0,
    numar_auto: null,
    ruta_transport: null,
    tip_marfa: null,
    cantitate_marfa: null,
    numar_document_marfa: null,
    numar_curse: 1,
    taxe_suplimentare: 0,
    km_parcursi: 0,
    tarif_km: 0,
    observatii: null,
  };
}

export function normalizeTemplateColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    return DEFAULT_RAI_COLUMNS.map((c) => ({ ...c }));
  }
  return columns.map((col, idx) => ({
    key: String(col.key || col.source || `col_${idx + 1}`),
    header: String(col.header || col.key || `Col ${idx + 1}`),
    source: col.source ? String(col.source) : '',
    default_value: col.default_value ?? '',
  }));
}

export function isCompleteRaiTemplate(columns) {
  const cols = normalizeTemplateColumns(columns);
  const sources = new Set(cols.map((c) => c.source));
  return cols.length >= 14 && ANNEX_SOURCE_KEYS.every((key) => sources.has(key));
}

function cellEmpty(value) {
  return value === undefined || value === null || value === '';
}

function defaultFilled(value) {
  return value !== undefined && value !== null && value !== '';
}

/** Fields the aviz PDF never contains; stored 0 means “not filled”. */
const ZERO_MEANS_UNSET = new Set([
  'valoare_tpo',
  'taxe_suplimentare',
  'km_parcursi',
  'tarif_km',
]);

function coerceCell(col, value) {
  if (!defaultFilled(value)) return '';
  if (NUMERIC_SOURCES.has(col.source) || NUMERIC_SOURCES.has(col.key)) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

function useTemplateDefault(col, raw) {
  if (cellEmpty(raw)) return defaultFilled(col.default_value);
  if (
    ZERO_MEANS_UNSET.has(col.source)
    && Number(raw) === 0
    && defaultFilled(col.default_value)
    && Number(col.default_value) !== 0
  ) {
    return true;
  }
  return false;
}

function formatDateCell(value) {
  if (!value) return '';
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(value);
}

/** Use the saved template as-is. Only fall back when it has no columns. */
export function resolveExportColumns(template) {
  const cols = normalizeTemplateColumns(template?.columns);
  if (cols.length === 0) return DEFAULT_RAI_COLUMNS.map((c) => ({ ...c }));
  return cols;
}

export function mapAnnexRows(columns, avize) {
  const cols = normalizeTemplateColumns(columns);
  return (avize || []).map((row, idx) => {
    const out = {};
    for (const col of cols) {
      if (col.source === 'nr_crt') {
        out[col.key] = idx + 1;
        continue;
      }
      const raw = col.source ? row?.[col.source] : undefined;
      if (useTemplateDefault(col, raw)) {
        out[col.key] = coerceCell(col, col.default_value);
      } else if (col.source === 'data_efectuare_cursa') {
        out[col.key] = formatDateCell(raw);
      } else {
        out[col.key] = coerceCell(col, raw);
      }
    }
    return out;
  });
}
