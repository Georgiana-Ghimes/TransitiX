/**
 * List query for Autoturisme: active plates, optional plate search, page sizes shared with the UI.
 */

/** Page sizes the Autoturisme UI offers. The API also accepts any integer 1…500. */
export const FLEET_PAGE_SIZES = [20, 50, 100, 500];
export const FLEET_DEFAULT_PAGE_SIZE = 50;
export const FLEET_MAX_PAGE_SIZE = 500;
/** Cap for select-all / bulk-delete id lists (fleet is smaller than avize annex batches). */
export const FLEET_ID_CAP = 5000;

export function normalizeFleetPage({ limit, offset } = {}) {
  const raw = Number(limit);
  const pageSize = Number.isFinite(raw) && raw >= 1 && raw <= FLEET_MAX_PAGE_SIZE
    ? Math.floor(raw)
    : FLEET_DEFAULT_PAGE_SIZE;
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  return { limit: pageSize, offset: off };
}

export function capFleetIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].slice(0, FLEET_ID_CAP);
}

/**
 * Shared WHERE for the page and its COUNT / missing-MTMA totals.
 * Active only: a lorry taken off the road does not need its MTMA chased on this screen.
 */
export function buildFleetFilterWhere({ companyId, q }) {
  const where = ['company_id = $1', 'is_active IS NOT FALSE'];
  const params = [companyId];
  let i = 2;
  const term = String(q || '').trim();
  if (term) {
    where.push(`strpos(lower(COALESCE(plate, '')), lower($${i})) > 0`);
    params.push(term);
    i += 1;
  }
  return { where, params, nextIndex: i };
}

export function buildFleetCountQuery(filters) {
  const { where, params } = buildFleetFilterWhere(filters);
  return {
    sql: `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE mma_kg IS NULL)::int AS missing_mma
     FROM vehicles
     WHERE ${where.join(' AND ')}`,
    params,
  };
}

export function buildFleetListQuery({ companyId, q, limit, offset }) {
  const { where, params, nextIndex } = buildFleetFilterWhere({ companyId, q });
  const page = normalizeFleetPage({ limit, offset });
  params.push(page.limit, page.offset);
  const sql = `SELECT *
    FROM vehicles
    WHERE ${where.join(' AND ')}
    ORDER BY plate ASC
    LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
  return { sql, params, page };
}

/** Every id matching the filter — used by „Selectează toate” across pages. */
export function buildFleetIdsQuery({ companyId, q }) {
  const { where, params, nextIndex } = buildFleetFilterWhere({ companyId, q });
  params.push(FLEET_ID_CAP);
  const sql = `SELECT id
    FROM vehicles
    WHERE ${where.join(' AND ')}
    ORDER BY plate ASC
    LIMIT $${nextIndex}`;
  return { sql, params };
}
