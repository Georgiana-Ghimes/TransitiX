/**
 * Display logic for the reporting screen, kept out of the component so it can be tested.
 *
 * The server decides what a report contains; this file only decides how it reads. The one rule
 * it shares with the server is that a missing figure is shown as missing — never as a zero that
 * a customer would take for a real measurement.
 */

export const WARNING_LABELS = {
  not_confirmed: 'Documente neconfirmate',
  needs_review: 'Câmpuri neverificate',
  missing_tpo: 'Fără număr TPO',
  missing_date: 'Fără dată de cursă',
  missing_gross_weight: 'Fără greutate brută',
  missing_invoice_date: 'Fără dată de facturare',
  weight_not_exported: 'Greutatea nu ajunge în raport',
  duplicate_tpo: 'TPO duplicat',
};

export const WARNING_HINTS = {
  weight_not_exported:
    'Documentele au greutatea de pe cântar, dar șablonul ales nu are coloană pentru ea. '
    + 'Raportul nu va putea fi verificat cu bonul de cântar.',
  missing_gross_weight:
    'Coloana de greutate rămâne goală pe aceste rânduri. Un zero ar arăta ca o mașină plecată goală.',
  duplicate_tpo: 'Același număr de TPO apare pe mai multe documente din selecție.',
  missing_invoice_date:
    'Coloana de dată facturare rămâne goală pe aceste rânduri. O poți completa pentru toată '
    + 'selecția deodată, din câmpul de deasupra tabelului.',
};

export function warningLabel(code) {
  return WARNING_LABELS[code] || code;
}

export function warningHint(code) {
  return WARNING_HINTS[code] || null;
}

/** Empty stays empty. `Number(null)` is 0, and a 0 kg row reads as a truck that went out empty. */
export function formatCell(value, column) {
  if (value === null || value === undefined || value === '') return '';
  if (!column?.numeric) return String(value);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const decimals = column.type === 'weight' || column.type === 'integer' ? 0 : 2;
  return num.toLocaleString('ro-RO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * The totals line as the table shows it: a value under every summed column, `TOTAL` in the first
 * column that has no total of its own, and nothing anywhere else.
 */
export function totalsRow(columns, totals) {
  if (!totals || Object.keys(totals).length === 0) return null;
  const labelKey = columns.find((col) => !totals[col.key])?.key ?? null;
  const cells = {};
  for (const col of columns) {
    if (totals[col.key]) cells[col.key] = formatCell(totals[col.key].value, col);
    else if (col.key === labelKey) cells[col.key] = 'TOTAL';
    else cells[col.key] = '';
  }
  return { cells, labelKey };
}

/** How many rows a column's total had nothing to add, so the footer can say it is partial. */
export function totalIsPartial(totals, key) {
  return Boolean(totals?.[key] && totals[key].missing > 0);
}

export const EMPTY_FILTERS = Object.freeze({
  from: '', to: '', status: '', plate: '', batch_id: '', q: '', with_weight: false,
});

/** Mirrors the server's refusal to run a report over the entire archive. */
export function hasCriteria(filters = {}) {
  return Boolean(
    filters.from || filters.to || filters.status || filters.plate
    || filters.batch_id || filters.q || filters.with_weight
    || (Array.isArray(filters.aviz_ids) && filters.aviz_ids.length)
  );
}

/** Strips the blanks so the request carries only what the operator actually chose. */
export function cleanFilters(filters = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === '' || value === false || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ro-RO');
}

/**
 * What an export's history row should say about whether it can still be trusted.
 *
 * An export whose documents were corrected afterwards is not wrong — it is what was sent. The
 * distinction that matters is whether the sheet still matches today's data.
 */
export function driftSummary(drift) {
  if (!drift) return { tone: 'unknown', text: 'Stare necunoscută' };
  if (!drift.reproducible) {
    return { tone: 'warn', text: 'Conținutul nu a fost salvat — nu poate fi reprodus identic' };
  }
  const changed = drift.changed_since?.length ?? 0;
  const missing = drift.missing_documents?.length ?? 0;
  if (!changed && !missing) return { tone: 'ok', text: 'Documentele sunt neschimbate de atunci' };
  const parts = [];
  if (changed) parts.push(`${changed} document${changed === 1 ? '' : 'e'} modificat${changed === 1 ? '' : 'e'} după export`);
  if (missing) parts.push(`${missing} șters${missing === 1 ? '' : 'e'} între timp`);
  return { tone: 'warn', text: parts.join(', ') };
}

/** Hands the browser a file the server generated. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
