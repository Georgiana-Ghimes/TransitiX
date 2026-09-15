/**
 * How a stored row was read. `vision` stays in the table for rows extracted before Google Vision
 * was removed, dropping it would relabel their history rather than erase a dependency.
 *
 * `paddle` and `none` are named explicitly because they are what the extractor actually writes
 * today: falling through to `stub` labelled a real PaddleOCR read, and a failed one, as though
 * no OCR had been attempted at all.
 */
export function mapProviderToSource(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'pdf_text' || p === 'pdf-text') return 'pdf-text';
  if (p === 'google_vision' || p === 'vision') return 'vision';
  if (p === 'paddle' || p === 'paddle_ocr' || p === 'paddleocr') return 'paddle';
  if (p === 'none') return 'none';
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

/**
 * What makes two rows the same delivery, rather than two curse of one TPO.
 *
 * A TPO is an order, and an order can legitimately be driven several times: the same
 * TPO-0025803 covers PSL-0044633 to Șos. Viilor on Monday and PSL-0044701 to Bd. Iuliu Maniu on
 * Tuesday. Treating a repeated TPO as a duplicate warned about double billing on every one of
 * those, which trains an operator to click past the warning, and a warning nobody reads is
 * worse than no warning: the real double upload goes through with the same shrug.
 *
 * The aviz number is the discriminator, because that is what the consignment is: two different
 * PSL numbers are two different loads whatever TPO paid for them, and the same PSL number twice
 * is the same paper counted twice.
 *
 * Without an aviz number there is nothing that precise, so the run plus where it went stands in.
 * Two rows that agree on the day, the lorry and the destination, and carry no document number
 * to tell them apart, have nothing left that distinguishes them.
 */
export function consignmentKey(row) {
  const doc = String(row?.numar_document_marfa || '').trim().toLowerCase();
  if (doc) return `doc:${doc}`;
  const route = String(row?.ruta_transport || '').trim().toLowerCase();
  return `run:${runIdentity(row)}|${route}`;
}

/**
 * Marks the rows that are the same consignment as another row in the set, under the same TPO.
 *
 * Still scoped to the TPO, which is where an operator looks when the annex totals are wrong.
 * The same aviz number appearing under two different TPOs is a different mistake and is not
 * what this flag has ever meant.
 */
export function flagDuplicateTpos(rows) {
  const counts = new Map();
  const keyOf = (row) => {
    const tpo = String(row?.numar_tpo || '').trim().toLowerCase();
    return tpo ? `${tpo}::${consignmentKey(row)}` : null;
  };
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.map((row) => {
    const key = keyOf(row);
    return { ...row, duplicate_tpo: Boolean(key && counts.get(key) > 1) };
  });
}

/**
 * One cursă ≠ one aviz. Same TPO with two trucks (or two days) is two runs; two unloadings
 * on the same truck/day stay one run. Prefer linked trip_id when present.
 */
export function runIdentity(row) {
  if (row?.trip_id) return `trip:${row.trip_id}`;
  const date = String(row?.data_efectuare_cursa || '').slice(0, 10) || '_';
  const auto = String(row?.numar_auto || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9/]/g, '');
  if (auto) return `${date}|${auto}`;
  // No plate: do not collapse unrelated unloadings into one phantom run.
  return `${date}|id:${row?.id || ''}`;
}

/**
 * Sets `numar_curse` on each row to the count of distinct runs sharing its TPO
 * (within the given set, typically the list view or the export selection).
 */
export function applyNumarCurseByRuns(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const runsByTpo = new Map();
  for (const row of list) {
    const tpo = String(row?.numar_tpo || '').trim().toLowerCase();
    if (!tpo) continue;
    if (!runsByTpo.has(tpo)) runsByTpo.set(tpo, new Set());
    runsByTpo.get(tpo).add(runIdentity(row));
  }
  return list.map((row) => {
    const tpo = String(row?.numar_tpo || '').trim().toLowerCase();
    if (!tpo) return { ...row, numar_curse: 1 };
    const count = runsByTpo.get(tpo)?.size || 1;
    return { ...row, numar_curse: count };
  });
}

/**
 * Whether another stored document is the same consignment as this one.
 *
 * The candidates are fetched and compared in JavaScript rather than matched in SQL, so this
 * and `flagDuplicateTpos` cannot drift apart: the list view and the single row would otherwise
 * each have their own opinion about what a duplicate is, and an operator would see a row
 * labelled duplicate in the table and not in the modal.
 *
 * `decorate` is how a caller hands over rows repaired from the stored OCR text. Comparing a
 * repaired row against raw candidates can only miss a duplicate, never invent one, but a
 * caller that can repair both should.
 */
export async function duplicateConsignmentExists(queryFn, { companyId, row, decorate }) {
  const tpo = String(row?.numar_tpo || '').trim();
  if (!tpo) return false;
  const result = await queryFn(
    `SELECT id, numar_tpo, numar_document_marfa, ruta_transport, data_efectuare_cursa,
            numar_auto, trip_id, extracted_data
     FROM aviz_documents
     WHERE company_id = $1 AND LOWER(numar_tpo) = LOWER($2) AND id <> $3
     LIMIT 50`,
    [companyId, tpo, row.id]
  );
  const shape = typeof decorate === 'function' ? decorate : (x) => x;
  const key = consignmentKey(row);
  return result.rows.some((other) => consignmentKey(shape(other)) === key);
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
 * `cursa` is the trip date read off the aviz, the one a monthly annex is built on. `incarcare`
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
 * Each clause carries a single `$n` placeholder, repeated where needed, callers substitute their
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
