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

export function buildAvizListQuery({ companyId, from, to, status, q, limit = 200 }) {
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
  const term = String(q || '').trim();
  if (term) {
    where.push(`(
      COALESCE(numar_tpo, '') ILIKE $${i}
      OR COALESCE(numar_auto, '') ILIKE $${i}
      OR COALESCE(numar_document_marfa, '') ILIKE $${i}
      OR COALESCE(original_filename, '') ILIKE $${i}
    )`);
    params.push(`%${term}%`);
    i += 1;
  }
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 200);
  params.push(cap);
  const sql = `SELECT * FROM aviz_documents WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${i}`;
  return { sql, params };
}
