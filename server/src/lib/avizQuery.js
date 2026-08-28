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
  return Boolean(row?.is_default) && String(row?.name || '').trim() === 'Anexa Factura RAI';
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

export function buildAvizListQuery({ companyId, from, to, status, q, uploadedFrom, limit = 200 }) {
  const where = ['company_id = $1'];
  const params = [companyId];
  let i = 2;
  if (from) {
    where.push(`data_efectuare_cursa >= $${i}`);
    params.push(from);
    i += 1;
  }
  if (to) {
    where.push(`data_efectuare_cursa <= $${i}`);
    params.push(to);
    i += 1;
  }
  if (status && ['uploaded', 'extracted', 'confirmed'].includes(status)) {
    where.push(`status = $${i}`);
    params.push(status);
    i += 1;
  }
  if (uploadedFrom && ['office', 'driver'].includes(uploadedFrom)) {
    where.push(`uploaded_from = $${i}`);
    params.push(uploadedFrom);
    i += 1;
  }
  const term = String(q || '').trim();
  if (term) {
    where.push(`(
      strpos(lower(COALESCE(numar_tpo, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(numar_auto, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(numar_document_marfa, '')), lower($${i})) > 0
      OR strpos(lower(COALESCE(original_filename, '')), lower($${i})) > 0
    )`);
    params.push(term);
    i += 1;
  }
  const cap = Math.min(Math.max(Number(limit) || 200, 1), AVIZ_ID_CAP);
  params.push(cap);
  const sql = `SELECT * FROM aviz_documents WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${i}`;
  return { sql, params };
}
