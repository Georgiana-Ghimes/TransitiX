/**
 * Turns a template plus a set of documents into a report: rows, a totals line, and the
 * warnings an operator should read before sending the sheet to a customer.
 *
 * The rows themselves still come from `mapAnnexRows`, so an existing template exports exactly
 * what it exported before. What is new is that the report knows what it is missing.
 */
import { mapAnnexRows, normalizeTemplateColumns } from '../avizTemplate.js';
import { canTotal, getSource, isNumericSource, WEIGHT_SOURCES } from './sources.js';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Column totals, for the columns where a total means something.
 *
 * A column is summed only if its source says so. `tarif_km` is a rate: ten trips at 2,50 lei/km
 * do not make 25 lei/km, and a footer saying so on a customer's sheet is worse than no footer.
 */
export function reportTotals(columns, rows) {
  const cols = normalizeTemplateColumns(columns);
  const totals = {};
  for (const col of cols) {
    if (!canTotal(col.source)) continue;
    let sum = 0;
    let seen = 0;
    for (const row of rows) {
      const num = toNumber(row?.[col.key]);
      if (num === null) continue;
      sum += num;
      seen += 1;
    }
    if (seen === 0) continue;
    totals[col.key] = {
      source: col.source,
      value: Math.round(sum * 10000) / 10000,
      counted: seen,
      missing: rows.length - seen,
    };
  }
  return totals;
}

function warn(list, code, severity, message, ids) {
  if (!ids.length) return;
  list.push({ code, severity, message, count: ids.length, document_ids: ids.slice(0, 50) });
}

/**
 * What an operator should know before this file leaves the building.
 *
 * None of these block the export — a dispatcher sometimes has to send an incomplete sheet and
 * say so on the phone. They exist so that choice is deliberate rather than accidental.
 */
export function reportWarnings(columns, documents) {
  const cols = normalizeTemplateColumns(columns);
  const sources = new Set(cols.map((c) => c.source));
  const docs = Array.isArray(documents) ? documents : [];
  const found = [];

  warn(found, 'not_confirmed', 'warning',
    'Documente neconfirmate incluse în raport.',
    docs.filter((d) => d.status && d.status !== 'confirmed').map((d) => d.id));

  warn(found, 'needs_review', 'warning',
    'Documente cu câmpuri necontrolate de un operator.',
    docs.filter((d) => d.needs_review).map((d) => d.id));

  warn(found, 'missing_tpo', 'warning',
    'Documente fără număr TPO.',
    sources.has('numar_tpo') ? docs.filter((d) => isBlank(d.numar_tpo)).map((d) => d.id) : []);

  warn(found, 'missing_date', 'warning',
    'Documente fără dată de efectuare a cursei.',
    sources.has('data_efectuare_cursa') ? docs.filter((d) => isBlank(d.data_efectuare_cursa)).map((d) => d.id) : []);

  warn(found, 'missing_invoice_date', 'warning',
    'Raportul are coloană de dată facturare, dar unele documente nu o au completată.',
    sources.has('data_facturare')
      ? docs.filter((d) => isBlank(d.data_facturare)).map((d) => d.id)
      : []);

  const exportsWeight = WEIGHT_SOURCES.some((key) => sources.has(key));
  if (exportsWeight) {
    warn(found, 'missing_gross_weight', 'warning',
      'Raportul are coloană de greutate brută, dar unele documente nu au valoarea.',
      docs.filter((d) => toNumber(d.gross_weight_kg) === null).map((d) => d.id));
  } else {
    // The report the client asked for is checked against a weighbridge ticket. If the documents
    // carry that figure and the template drops it, the sheet cannot be reconciled — so say so
    // rather than quietly exporting a sack count in its place.
    warn(found, 'weight_not_exported', 'warning',
      'Documentele au greutate brută, dar șablonul nu o exportă.',
      docs.filter((d) => toNumber(d.gross_weight_kg) !== null).map((d) => d.id));
  }

  const seenTpo = new Map();
  for (const doc of docs) {
    const tpo = String(doc.numar_tpo || '').trim().toLowerCase();
    if (!tpo) continue;
    seenTpo.set(tpo, [...(seenTpo.get(tpo) || []), doc.id]);
  }
  warn(found, 'duplicate_tpo', 'warning',
    'Același TPO apare pe mai multe documente.',
    [...seenTpo.values()].filter((ids) => ids.length > 1).flat());

  return found;
}

/** Column metadata the preview and the exporter both need. */
export function describeColumns(columns) {
  return normalizeTemplateColumns(columns).map((col) => {
    const source = getSource(col.source);
    return {
      key: col.key,
      header: col.header,
      source: col.source,
      type: source?.type || 'text',
      numeric: isNumericSource(col.source),
      totalled: canTotal(col.source),
    };
  });
}

export function buildReport({ template, documents }) {
  const columns = normalizeTemplateColumns(template?.columns);
  const docs = Array.isArray(documents) ? documents : [];
  const rows = mapAnnexRows(columns, docs);
  return {
    columns: describeColumns(columns),
    rows,
    totals: reportTotals(columns, rows),
    warnings: reportWarnings(columns, docs),
    row_count: rows.length,
  };
}
