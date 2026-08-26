/**
 * Choosing the documents that go into a report.
 *
 * Picking rows by hand works for five avize and stops working at eighty, which is the volume the
 * client actually has at month end. A selection is therefore a set of criteria the operator can
 * state once — period, vehicle, lot, status — and re-state next month.
 */

export const SELECTION_CAP = 500;

const STATUSES = ['uploaded', 'extracted', 'confirmed'];

function trimmed(value, max = 120) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function isoDate(value) {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** The filters as they will be stored on the export log, so history can show what was asked for. */
export function normaliseFilters(input = {}) {
  const ids = [...new Set((Array.isArray(input.aviz_ids) ? input.aviz_ids : []).filter(Boolean))];
  return {
    from: isoDate(input.from),
    to: isoDate(input.to),
    status: STATUSES.includes(input.status) ? input.status : null,
    plate: trimmed(input.plate, 40),
    batch_id: trimmed(input.batch_id, 64),
    q: trimmed(input.q, 80),
    document_type: ['aviz', 'cmr', 'other'].includes(input.document_type) ? input.document_type : null,
    with_weight: input.with_weight === true,
    aviz_ids: ids.slice(0, SELECTION_CAP),
    limit: Math.min(Math.max(Number(input.limit) || SELECTION_CAP, 1), SELECTION_CAP),
  };
}

/** True when the operator gave us nothing to narrow by, which would select the whole archive. */
export function isEmptySelection(filters) {
  const f = normaliseFilters(filters);
  return !f.from && !f.to && !f.status && !f.plate && !f.batch_id && !f.q
    && !f.document_type && !f.with_weight && f.aviz_ids.length === 0;
}

export function buildSelectionQuery(companyId, input = {}) {
  const f = normaliseFilters(input);
  const where = ['company_id = $1'];
  const params = [companyId];
  let i = 2;

  const add = (clause, value) => {
    where.push(clause.replace(/\$n/g, `$${i}`));
    params.push(value);
    i += 1;
  };

  // An explicit id list wins: the operator ticked those rows and means exactly those.
  if (f.aviz_ids.length) add('id = ANY($n::uuid[])', f.aviz_ids);
  if (f.from) add('data_efectuare_cursa >= $n', f.from);
  if (f.to) add('data_efectuare_cursa <= $n', f.to);
  if (f.status) add('status = $n', f.status);
  if (f.batch_id) add('batch_id = $n::uuid', f.batch_id);
  if (f.document_type) add('document_type = $n', f.document_type);
  if (f.plate) add("strpos(lower(COALESCE(numar_auto, '')), lower($n)) > 0", f.plate);
  if (f.q) {
    add(`(
      strpos(lower(COALESCE(numar_tpo, '')), lower($n)) > 0
      OR strpos(lower(COALESCE(numar_document_marfa, '')), lower($n)) > 0
      OR strpos(lower(COALESCE(ruta_transport, '')), lower($n)) > 0
      OR strpos(lower(COALESCE(original_filename, '')), lower($n)) > 0
    )`, f.q);
  }
  if (f.with_weight) where.push('gross_weight_kg IS NOT NULL');

  params.push(f.limit);
  const sql = `SELECT * FROM aviz_documents
    WHERE ${where.join(' AND ')}
    ORDER BY data_efectuare_cursa ASC NULLS LAST, created_at ASC
    LIMIT $${i}`;
  return { sql, params, filters: f };
}

/** A short human sentence describing a stored selection, for the history list. */
export function describeSelection(filters) {
  const f = normaliseFilters(filters || {});
  const parts = [];
  if (f.from && f.to) parts.push(`${f.from} → ${f.to}`);
  else if (f.from) parts.push(`din ${f.from}`);
  else if (f.to) parts.push(`până la ${f.to}`);
  if (f.plate) parts.push(`auto ${f.plate}`);
  if (f.batch_id) parts.push('un lot');
  if (f.status) parts.push(f.status === 'confirmed' ? 'confirmate' : f.status);
  if (f.with_weight) parts.push('cu greutate');
  if (f.q) parts.push(`caută „${f.q}”`);
  if (!parts.length && f.aviz_ids.length) parts.push(`${f.aviz_ids.length} documente alese manual`);
  return parts.join(', ') || 'toate documentele';
}
