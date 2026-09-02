/**
 * How a stored row was read. `vision` stays in the table for rows extracted before Google Vision
 * was removed — dropping it would relabel their history rather than erase a dependency.
 */
export function mapProviderToSource(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'pdf_text' || p === 'pdf-text') return 'pdf-text';
  if (p === 'google_vision' || p === 'vision') return 'vision';
  return 'stub';
}

export function annexDraftAmount(row, rule = 'tpo') {
  const tpo = Number(row?.valoare_tpo) || 0;
  const km = Number(row?.km_parcursi) || 0;
  const tarif = Number(row?.tarif_km) || 0;
  if (rule === 'km_tarif') return Math.round(km * tarif * 100) / 100;
  return tpo;
}

export function isLockedRaiTemplate(row) {
  return String(row?.name || '').trim() === 'Anexa Factura RAI';
}

export function flagDuplicateTpos(rows) {
  const counts = new Map();
  for (const row of rows) {
    const tpo = String(row.numar_tpo || '').trim().toLowerCase();
    if (!tpo) continue;
    counts.set(tpo, (counts.get(tpo) || 0) + 1);
  }
  return rows.map((row) => {
    const tpo = String(row.numar_tpo || '').trim().toLowerCase();
    return { ...row, duplicate_tpo: Boolean(tpo && counts.get(tpo) > 1) };
  });
}

export async function tpoExistsForOther(queryFn, { companyId, tpo, exceptId }) {
  const term = String(tpo || '').trim();
  if (!term) return false;
  const result = await queryFn(
    `SELECT 1 FROM aviz_documents
     WHERE company_id = $1 AND LOWER(numar_tpo) = LOWER($2) AND id <> $3
     LIMIT 1`,
    [companyId, term, exceptId]
  );
  return Boolean(result.rows[0]);
}

export const AVIZ_ID_CAP = 200;

export function capAvizIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].slice(0, AVIZ_ID_CAP);
}

export function pickConfirmedAvize(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row.status === 'confirmed');
}

export function templateDeleteDecision({ count, existing }) {
  if (Number(count) <= 1) return 'keep_one';
  if (!existing) return 'not_found';
  if (isLockedRaiTemplate(existing)) return 'locked_rai';
  return 'ok';
}

export function templateUpdateDecision(existing) {
  if (!existing) return 'not_found';
  if (isLockedRaiTemplate(existing)) return 'locked_rai';
  return 'ok';
}

export function uniqueZipEntry(name, used) {
  const raw = String(name || 'file').replace(/\\/g, '/');
  const base = raw.replace(/^.*\//, '') || 'file';
  const dir = raw.includes('/') ? raw.slice(0, raw.lastIndexOf('/') + 1) : '';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let candidate = `${dir}${base}`;
  let n = 1;
  while (used.has(candidate)) {
    candidate = `${dir}${stem}-${n}${ext}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Which calendar date the `from`/`to` filters mean, as clauses rather than a bare expression.
 *
 * `cursa` is the trip date read off the aviz — the one a monthly annex is built on. `incarcare`
 * is when the file reached us, expressed in Bucharest so a 23:30 upload does not count as the
 * next day. They are far apart in practice: an aviz photographed today can carry a trip date
 * from two weeks ago, which is why a week preset on the trip date can come back empty while the
 * month preset does not.
 *
 * A row OCR has not dated yet falls back to its upload day, otherwise a document uploaded today
 * would be invisible under today's date filter until extraction finishes.
 *
 * Both bounds compare the stored column rather than an expression over it, so the indexes on
 * `(company_id, data_efectuare_cursa)` and `(company_id, created_at)` remain candidates. A
 * functional index could not stand in for that: `AT TIME ZONE` is STABLE, not IMMUTABLE, and
 * Postgres refuses it in an index.
 *
 * Each clause carries a single `$n` placeholder, repeated where needed — callers substitute their
 * own parameter index and push one value.
 */
export function avizDateClauses(dateField, alias = '') {
  const col = alias ? `${alias}.` : '';
  const dayStart = `($n::date AT TIME ZONE 'Europe/Bucharest')`;
  const nextDayStart = `(($n::date + 1) AT TIME ZONE 'Europe/Bucharest')`;
  if (dateField === 'incarcare') {
    return {
      from: `${col}created_at >= ${dayStart}`,
      to: `${col}created_at < ${nextDayStart}`,
    };
  }
  return {
    from: `(${col}data_efectuare_cursa >= $n::date`
      + ` OR (${col}data_efectuare_cursa IS NULL AND ${col}created_at >= ${dayStart}))`,
    to: `(${col}data_efectuare_cursa <= $n::date`
      + ` OR (${col}data_efectuare_cursa IS NULL AND ${col}created_at < ${nextDayStart}))`,
  };
}

export function buildAvizListQuery({
  companyId, from, to, status, q, uploadedFrom, dateField, limit = 200,
}) {
  const where = ['a.company_id = $1'];
  const params = [companyId];
  const dateClauses = avizDateClauses(dateField, 'a');
  let i = 2;
  if (from) {
    where.push(dateClauses.from.replace(/\$n/g, `$${i}`));
    params.push(from);
    i += 1;
  }
  if (to) {
    where.push(dateClauses.to.replace(/\$n/g, `$${i}`));
    params.push(to);
    i += 1;
  }
  if (status && ['uploaded', 'extracted', 'confirmed'].includes(status)) {
    where.push(`a.status = $${i}`);
    params.push(status);
    i += 1;
  }
  if (uploadedFrom && ['office', 'driver'].includes(uploadedFrom)) {
    where.push(`a.uploaded_from = $${i}`);
    params.push(uploadedFrom);
    i += 1;
  }
  const term = String(q || '').trim();
  if (term) {
    where.push(`(
      strpos(lower(COALESCE(a.numar_tpo, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(a.numar_auto, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(a.numar_document_marfa, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(a.original_filename, '')), lower($${i})) > 0
    )`);
    params.push(term);
    i += 1;
  }
  const cap = Math.min(Math.max(Number(limit) || 200, 1), AVIZ_ID_CAP);
  params.push(cap);
  const sql = `SELECT a.*, u.name AS uploaded_by_name
    FROM aviz_documents a
    LEFT JOIN users u ON u.id = a.uploaded_by AND u.company_id = a.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.created_at DESC
    LIMIT $${i}`;
  return { sql, params };
}
