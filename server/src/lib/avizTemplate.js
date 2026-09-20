/** Anexa Factura RAI column map (A–N on the model sheet). */
import { getSource } from './reporting/sources.js';
import { applyNumarCurseByRuns, isLockedRaiTemplate } from './avizQuery.js';
import { isGenericCountUnit } from './ocr/fields.js';

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
  { key: 'nr_crt', header: 'Nr. Crt.', source: 'nr_crt', default_value: '' },
  { key: 'numar_tpo', header: 'Numar TPO', source: 'numar_tpo', default_value: '' },
  { key: 'data_efectuare_cursa', header: 'Data efectuare cursa', source: 'data_efectuare_cursa', default_value: '' },
  { key: 'valoare_tpo', header: 'Valoare TPO', source: 'valoare_tpo', default_value: 0 },
  { key: 'numar_auto', header: 'Numar auto', source: 'numar_auto', default_value: '' },
  { key: 'ruta_transport', header: 'Ruta transport', source: 'ruta_transport', default_value: '' },
  { key: 'tip_marfa', header: 'Tip marfa', source: 'tip_marfa', default_value: '' },
  { key: 'cantitate_marfa', header: 'Cantitate marfa (tone)', source: 'cantitate_marfa', default_value: '' },
  { key: 'numar_document_marfa', header: 'Numar document marfa (aviz/factura)', source: 'numar_document_marfa', default_value: '' },
  { key: 'numar_curse', header: 'Numar curse', source: 'numar_curse', default_value: 1 },
  { key: 'taxe_suplimentare', header: 'Taxe suplimentare', source: 'taxe_suplimentare', default_value: 0 },
  { key: 'km_parcursi', header: 'Km parcursi', source: 'km_parcursi', default_value: 0 },
  { key: 'tarif_km', header: 'Tarif Km', source: 'tarif_km', default_value: 0 },
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
    numar_sor: null,
    gross_weight_kg: null,
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

/**
 * Anexa Factura RAI column “Cantitate marfa (tone)” must carry weighbridge tons when
 * we have greutate brută, not the sack/bucket line count OCR also finds on the same page.
 *
 * `include_gross_in_annex === false` opts the row out of that column only (UI checkbox).
 * Zone tax still uses `gross_weight_kg` and is unaffected.
 */
export function annexQuantityValue(row) {
  if (row?.include_gross_in_annex === false || row?.include_gross_in_annex === 'false') {
    return null;
  }
  const kg = Number(row?.gross_weight_kg);
  if (Number.isFinite(kg) && kg > 0) {
    return Math.round((kg / 1000) * 100) / 100;
  }
  // No weight, no number. Falling back to the line count filled a column headed "(tone)" with
  // a count of sacks, so one sheet carried two units under one heading: 378 sitting beside
  // 21.00 and 16.20. Twenty times too large is obvious to anyone who looks, and invisible to
  // anyone who does not, and nothing in the file says which rows are which.
  //
  // Blank instead, with `missing_quantity_weight` naming the documents. The operator can type
  // the weighbridge figure on the row; a number in the wrong unit cannot be corrected by
  // anybody downstream, because it does not look wrong until it is added up.
  return null;
}

/**
 * Client Anexa wants Tip marfa = packaging unit (saci / galeti / …), not an empty cell while
 * the unit sits only in quantity_unit or is glued into Marfă on screen.
 */
const GOODS_UNIT_ALIASES = Object.freeze({
  sac: 'saci',
  saci: 'saci',
  galeti: 'galeti',
  galeti_: 'galeti',
  galeata: 'galeti',
  galeate: 'galeti',
  paleti: 'paleti',
  palet: 'paleti',
  palete: 'paleti',
  bucati: 'bucati',
  buc: 'bucati',
  pcs: 'bucati',
  kg: 'kg',
  role: 'role',
  colete: 'colete',
  mc: 'mc',
  m3: 'mc',
});

function foldGoodsToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Map OCR / tip text onto a canonical packaging unit, or null if it is not a unit. */
export function normalizeGoodsUnit(raw) {
  const folded = foldGoodsToken(raw);
  if (!folded) return null;
  if (GOODS_UNIT_ALIASES[folded]) return GOODS_UNIT_ALIASES[folded];
  if (folded.startsWith('sac')) return 'saci';
  if (folded.startsWith('gal')) return 'galeti';
  if (folded.startsWith('pal')) return 'paleti';
  if (folded.startsWith('buc')) return 'bucati';
  return null;
}

/**
 * Tip marfa for export: packaging the document / operator named, never a bare count word.
 *
 * `quantity_unit` often stays on "buc" from `Cantitate … buc` even after Tip marfa was
 * corrected to "galeti" on screen — preferring the unit column blindly put "bucati" back
 * onto the customer's annex. A tip that is itself a packaging unit wins; otherwise a
 * non-generic quantity_unit; otherwise free-text tip (product name). "bucati" alone never
 * reaches the sheet.
 */
export function annexTipMarfa(row) {
  const fromTip = normalizeGoodsUnit(row?.tip_marfa);
  if (fromTip && !isGenericCountUnit(fromTip)) return fromTip;

  const fromUnit = normalizeGoodsUnit(row?.quantity_unit);
  if (fromUnit && !isGenericCountUnit(fromUnit)) return fromUnit;

  const tip = String(row?.tip_marfa || '').trim();
  if (!tip) return '';
  if (fromTip && isGenericCountUnit(fromTip)) return '';
  return tip;
}

/** Use the saved template as-is. Only fall back when it has no columns. */
export function resolveExportColumns(template) {
  const cols = normalizeTemplateColumns(template?.columns);
  if (cols.length === 0) return DEFAULT_RAI_COLUMNS.map((c) => ({ ...c }));
  return cols;
}

export function hasUsableColumns(columns) {
  return Array.isArray(columns) && columns.length > 0;
}

/**
 * Export must never invent a layout. A stored template with no columns used to fall through to
 * the 14 RAI defaults, which on the operator's screen is indistinguishable from the export
 * ignoring the template they picked. Fail loudly instead.
 */
export function exportColumnsFor(template) {
  // The locked annex is defined here, not by whatever was written into `report_templates` the
  // day a company was seeded. Those rows are never updated afterwards, so a header corrected in
  // code would reach new installs only, and two companies on the same version would send the
  // customer two different sheets. Nobody can edit this template anyway.
  if (isLockedRaiTemplate(template)) return DEFAULT_RAI_COLUMNS.map((c) => ({ ...c }));

  if (!hasUsableColumns(template?.columns)) {
    const err = new Error(
      `Șablonul „${template?.name || 'selectat'}” nu are nicio coloană salvată. `
      + 'Deschide-l în tab-ul Șabloane și adaugă cel puțin o coloană.'
    );
    err.status = 400;
    throw err;
  }
  return normalizeTemplateColumns(template.columns);
}

export function mapAnnexRows(columns, avize) {
  const cols = normalizeTemplateColumns(columns);
  // Derive Numar curse from distinct runs per TPO (not the stored default of 1).
  const docs = applyNumarCurseByRuns(avize);
  return docs.map((row, idx) => {
    const out = {};
    for (const col of cols) {
      if (col.source === 'nr_crt') {
        out[col.key] = idx + 1;
        continue;
      }
      const raw = col.source === 'cantitate_marfa'
        ? annexQuantityValue(row)
        : col.source === 'tip_marfa'
          ? annexTipMarfa(row)
          : (col.source ? row?.[col.source] : undefined);
      if (useTemplateDefault(col, raw)) {
        out[col.key] = coerceCell(col, col.default_value);
      } else if (getSource(col.source)?.type === 'date') {
        // Driven by the declared type, not by a hard-coded column name: the moment a second
        // date source appeared, the name check silently left it in ISO on the customer's sheet.
        out[col.key] = formatDateCell(raw);
      } else {
        out[col.key] = coerceCell(col, raw);
      }
    }
    return out;
  });
}
