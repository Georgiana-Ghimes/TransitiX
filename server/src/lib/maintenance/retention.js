/**
 * Housekeeping for the tables that only ever grow.
 *
 * Nothing in this system deleted anything. `telematics_positions` takes a row per GPS ping — ten
 * trucks pinging once a minute is roughly five million rows a year — and there was no policy at
 * all, so the table would grow until somebody noticed the disk.
 *
 * The line this file will not cross: **a record of what we sent a customer, or of what a person
 * did, is never pruned.** `aviz_export_log` holds the exact sheets that left the building and
 * `document_events` is the trail explaining an OCR correction months later. Those are the reason
 * the rest of the system can be trusted; only telemetry and caches are on the list below.
 */
import { query } from '../../db.js';

/**
 * A policy names its table, its primary key and the condition for "old enough".
 *
 * Both the count and the delete are built from that one condition, so a preview can never
 * describe something different from what the run would remove.
 */
export const POLICIES = [
  {
    id: 'telematics_positions',
    table: 'telematics_positions',
    key: 'id',
    where: "recorded_at < NOW() - ($1::int || ' days')::interval",
    label: 'Poziții GPS istorice',
    days: 90,
    reason: 'Firul de urmărire pentru replay. Ruta planificată și km realizați rămân pe cursă.',
  },
  {
    id: 'gps_logs',
    table: 'gps_logs',
    key: 'id',
    where: "is_current IS NOT TRUE AND created_at < NOW() - ($1::int || ' days')::interval",
    label: 'Poziții vechi din gps_logs',
    days: 30,
    reason: 'Proiecția „ultima poziție cunoscută" rămâne: rândurile is_current nu se șterg.',
  },
  {
    id: 'chat_messages',
    table: 'chat_messages',
    key: 'id',
    where: "created_at < NOW() - ($1::int || ' days')::interval",
    label: 'Mesaje dispecer–șofer',
    days: 365,
    reason: 'Conversație operațională, nu document.',
  },
  {
    id: 'office_notification_dismissals',
    table: 'office_notification_dismissals',
    key: 'id',
    where: "dismissed_at < NOW() - ($1::int || ' days')::interval",
    label: 'Alerte închise manual',
    days: 180,
    reason: 'Cheile calculate se schimbă odată cu datele; una veche nu mai are ce ascunde.',
  },
  {
    id: 'refresh_tokens',
    table: 'refresh_tokens',
    key: 'jti',
    where: "expires_at < NOW() - ($1::int || ' days')::interval",
    label: 'Sesiuni expirate',
    days: 30,
    reason: 'Rânduri expirate de mult; revocarea nu mai are ce verifica.',
  },
  {
    // Deliberately long. Dropping a cached geocode costs a paid lookup to get it back, so the
    // policy here is about abandoned addresses, not about size.
    id: 'geocode_cache',
    table: 'geocode_cache',
    key: 'id',
    where: "updated_at < NOW() - ($1::int || ' days')::interval",
    label: 'Adrese geocodate nefolosite',
    days: 730,
    reason: 'Ștergerea costă o interogare plătită ca să revină; se taie doar ce e vechi de doi ani.',
  },
];

/** Tables this file will not touch, and why — so the next person does not add them by reflex. */
export const NEVER_PRUNED = [
  { table: 'aviz_export_log', reason: 'Conține foile exact cum au plecat la client. Fără ele, un export nu se mai poate reproduce.' },
  { table: 'audit_events', reason: 'Cine ce a schimbat. Un jurnal cu goluri nu se distinge de „nu s-a întâmplat nimic".' },
  { table: 'document_events', reason: 'Urma care explică o corecție OCR peste luni. Asta e explicabilitatea sistemului.' },
  { table: 'trip_charges', reason: 'Componentele unui TPO deja facturat.' },
  { table: 'invoice_lines', reason: 'Din ce e făcută o factură emisă.' },
  { table: 'delivery_proofs', reason: 'Semnături de predare — dovada livrării.' },
  { table: 'trip_documents', reason: 'Scrisorile de transport, scanate sau semnate digital.' },
];

export const DEFAULT_BATCH = 5000;
const LOCK_ID = 8123001;

export function countSql(policy) {
  return `SELECT COUNT(*)::int AS c FROM ${policy.table} WHERE ${policy.where}`;
}

/**
 * Deliberately batched.
 *
 * A single `DELETE` over millions of rows takes a long lock and bloats the table. Each pass
 * removes at most `batch` rows and reports whether more remain, so a scheduled run stays short
 * and predictable rather than occasionally stalling the API.
 */
export function deleteSql(policy) {
  return `DELETE FROM ${policy.table} WHERE ${policy.key} IN (
            SELECT ${policy.key} FROM ${policy.table} WHERE ${policy.where} LIMIT $2)`;
}

/** Days for one policy: an explicit override, then the environment, then the default. */
export function policyDays(policy, overrides = {}, env = process.env) {
  for (const candidate of [overrides[policy.id], env[`RETAIN_${policy.id.toUpperCase()}_DAYS`]]) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return Math.floor(num);
  }
  return policy.days;
}

/** How many rows each policy would remove, without removing them. */
export async function previewRetention(overrides = {}) {
  const rows = [];
  for (const policy of POLICIES) {
    const days = policyDays(policy, overrides);
    const base = { id: policy.id, label: policy.label, days, reason: policy.reason };
    try {
      const found = await query(countSql(policy), [days]);
      rows.push({ ...base, rows: found.rows[0]?.c ?? 0 });
    } catch (err) {
      rows.push({ ...base, error: err.message });
    }
  }
  return rows;
}

/**
 * Runs the policies once.
 *
 * Guarded by a Postgres advisory lock so two instances — or a manual run landing on top of the
 * scheduled one — cannot delete concurrently and fight over the same pages.
 */
export async function runRetention({ batch = DEFAULT_BATCH, overrides = {} } = {}) {
  const lock = await query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_ID]);
  if (!lock.rows[0]?.got) {
    return { skipped: true, reason: 'Curățenia rulează deja în altă parte.', results: [], deleted: 0 };
  }

  const results = [];
  try {
    for (const policy of POLICIES) {
      const days = policyDays(policy, overrides);
      try {
        const res = await query(deleteSql(policy), [days, batch]);
        results.push({
          id: policy.id,
          days,
          deleted: res.rowCount,
          // A full batch means the backlog is bigger than one pass; the next run continues.
          more: res.rowCount >= batch,
        });
      } catch (err) {
        console.error('[retention]', policy.id, err.message);
        results.push({ id: policy.id, days, deleted: 0, error: err.message });
      }
    }
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }

  return {
    skipped: false,
    results,
    deleted: results.reduce((sum, r) => sum + (r.deleted ?? 0), 0),
    more: results.some((r) => r.more),
  };
}
