/**
 * Runs the data-quality rules over a company's live data.
 *
 * Everything that touches the database lives here; the judgements live in `rules.js`. The split
 * exists so a rule can be argued about in a test without a schema, and so a query can be tuned
 * without re-reading the reasoning.
 */
import { query } from '../../db.js';
import {
  checkDocument,
  checkDuplicateTpo,
  checkTrip,
  sortFindings,
  summariseFindings,
} from './rules.js';

/**
 * How far back to look.
 *
 * A finding on a trip from two years ago is archaeology, not a task. Ninety days covers the
 * open billing period and the one before it, which is the window anyone can still act in.
 */
export const DEFAULT_WINDOW_DAYS = 90;

/** Enough rows to cover a busy quarter without letting one bad import flood the screen. */
const ROW_CAP = 500;

async function loadTrips(companyId, windowDays) {
  const found = await query(
    `SELECT t.id, t.cmr_number, t.tpo_number, t.contract_id, t.loading_date, t.distance_km,
            t.tpo_total, t.tpo_calculated_at, t.updated_at, t.status,
            v.vehicle_class,
            COALESCE(c.total, 0) AS charges_total,
            td.source AS cmr_source,
            td.signed_loading_at AS cmr_signed_loading_at,
            td.signed_delivery_at AS cmr_signed_delivery_at
     FROM trips t
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN (
       SELECT trip_id, SUM(amount) AS total
       FROM trip_charges WHERE company_id = $1 GROUP BY trip_id
     ) c ON c.trip_id = t.id
     LEFT JOIN LATERAL (
       SELECT source, signed_loading_at, signed_delivery_at
       FROM trip_documents
       WHERE company_id = $1 AND trip_id = t.id
       ORDER BY created_at ASC LIMIT 1
     ) td ON TRUE
     WHERE t.company_id = $1
       AND t.status <> 'anulata'
       AND t.loading_date >= CURRENT_DATE - $2::int
     ORDER BY t.loading_date DESC
     LIMIT ${ROW_CAP}`,
    [companyId, windowDays]
  );
  return found.rows;
}

async function loadTariffsByContract(companyId, trips) {
  const contractIds = [...new Set(trips.map((t) => t.contract_id).filter(Boolean))];
  if (!contractIds.length) return new Map();
  const found = await query(
    `SELECT * FROM contract_tariffs WHERE company_id = $1 AND contract_id = ANY($2::uuid[])`,
    [companyId, contractIds]
  );
  const byContract = new Map();
  for (const row of found.rows) {
    if (!byContract.has(row.contract_id)) byContract.set(row.contract_id, []);
    byContract.get(row.contract_id).push(row);
  }
  return byContract;
}

async function loadDocuments(companyId, windowDays) {
  const found = await query(
    `SELECT id, original_filename, status, numar_tpo, gross_weight_kg, trip_id, data_efectuare_cursa
     FROM aviz_documents
     WHERE company_id = $1
       AND (data_efectuare_cursa IS NULL OR data_efectuare_cursa >= CURRENT_DATE - $2::int)
     ORDER BY created_at DESC
     LIMIT ${ROW_CAP}`,
    [companyId, windowDays]
  );
  return found.rows;
}

/**
 * Every finding for a company, newest data first.
 *
 * @param {string} companyId
 * @param {object} [options]
 * @param {number} [options.windowDays] how far back to look
 */
export async function collectFindings(companyId, { windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const days = Math.min(Math.max(Number(windowDays) || DEFAULT_WINDOW_DAYS, 1), 730);
  const [trips, documents] = await Promise.all([
    loadTrips(companyId, days),
    loadDocuments(companyId, days),
  ]);
  const tariffsByContract = await loadTariffsByContract(companyId, trips);

  const findings = [];
  for (const trip of trips) {
    findings.push(...checkTrip(trip, (t) => tariffsByContract.get(t.contract_id) ?? []));
  }
  for (const doc of documents) {
    findings.push(...checkDocument(doc));
  }
  findings.push(...checkDuplicateTpo(documents));

  return {
    findings: sortFindings(findings),
    summary: summariseFindings(findings),
    window_days: days,
    checked: { trips: trips.length, documents: documents.length },
  };
}
