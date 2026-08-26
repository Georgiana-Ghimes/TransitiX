import { query } from '../db.js';

const STATUS_LABELS = {
  planificata: 'De planificat',
  alocata: 'Alocată',
  incarcata: 'Încărcată',
  in_tranzit: 'În tranzit',
  livrata: 'Livrată',
  problema: 'Problemă',
  anulata: 'Anulată',
};

export async function createOfficeNotification({
  company_id,
  type,
  title,
  message,
  link = null,
  trip_id = null,
  cmr_number = null,
}) {
  await query(
    `INSERT INTO office_notifications (company_id, type, title, message, link, trip_id, cmr_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [company_id, type, title, message, link, trip_id, cmr_number]
  );
}

export async function notifyTripStatusChange(companyId, trip, oldStatus, newStatus) {
  if (!newStatus || oldStatus === newStatus) return;
  const label = STATUS_LABELS[newStatus] || newStatus;
  const driver = trip.driver_name || 'Șoferul';
  const type = newStatus === 'problema' ? 'trip_problem' : 'trip_status';
  await createOfficeNotification({
    company_id: companyId,
    type,
    title: `${trip.cmr_number || 'Cursă'} → ${label}`,
    message: `${driver} a actualizat statusul cursei la „${label}”.`,
    link: `/trips/${trip.id}`,
    trip_id: trip.id,
    cmr_number: trip.cmr_number,
  });
}

export async function notifyCmrPending(companyId, trip) {
  if (!trip?.id) return;
  const driver = trip.driver_name || 'Șoferul';
  await query(
    `INSERT INTO office_notifications (company_id, type, title, message, link, trip_id, cmr_number)
     VALUES ($1, 'cmr_pending', $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, trip_id) WHERE type = 'cmr_pending' AND is_read = FALSE DO NOTHING`,
    [
      companyId,
      `CMR de confirmat — ${trip.cmr_number || 'Cursă'}`,
      `${driver} a încărcat documentul CMR. Verifică datele OCR pe cursă.`,
      `/trips/${trip.id}`,
      trip.id,
      trip.cmr_number,
    ]
  );
}

export async function dismissCmrPending(companyId, tripId) {
  if (!tripId) return;
  await query(
    `UPDATE office_notifications
     SET is_read = TRUE, updated_at = NOW()
     WHERE company_id = $1 AND type = 'cmr_pending' AND trip_id = $2 AND is_read = FALSE`,
    [companyId, tripId]
  );
}

export async function notifyClientConfirmed(companyId, trip, { has_damage, confirmed_by_name }) {
  const type = has_damage ? 'client_damage' : 'client_confirmed';
  await createOfficeNotification({
    company_id: companyId,
    type,
    title: has_damage
      ? `Avarii raportate — ${trip?.cmr_number || 'CMR'}`
      : `Livrare confirmată — ${trip?.cmr_number || 'CMR'}`,
    message: has_damage
      ? `${confirmed_by_name || 'Clientul'} a raportat avarii la recepție.`
      : `${confirmed_by_name || 'Clientul'} a confirmat recepția mărfii.`,
    link: trip?.id ? `/trips/${trip.id}` : null,
    trip_id: trip?.id || null,
    cmr_number: trip?.cmr_number || null,
  });
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const computedCache = new Map();

export function invalidateComputedNotificationsCache(companyId) {
  if (companyId) computedCache.delete(companyId);
  else computedCache.clear();
}

function normalizeDateKey(dateStr) {
  if (!dateStr) return '';
  if (dateStr instanceof Date) return dateStr.toISOString().slice(0, 10);
  const s = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

function checkExpiry(dateStr, type, name, link) {
  if (!dateStr) return null;
  const now = new Date();
  const in30Days = new Date();
  in30Days.setDate(now.getDate() + 30);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime()) || d > in30Days) return null;
  const expired = d < now;
  const dateKey = normalizeDateKey(dateStr);
  return {
    id: `computed:document_expiry:${type}:${name}:${dateKey}`,
    type: 'document_expiry',
    title: expired ? `${type} expirat` : `${type} expiră curând`,
    message: `${name} — ${expired ? 'expirat' : 'expiră'} ${d.toLocaleDateString('ro-RO')}`,
    link,
    trip_id: null,
    cmr_number: null,
    is_read: false,
    computed: true,
    created_at: now.toISOString(),
    created_date: now.toISOString(),
  };
}

export async function getDismissalState(companyId) {
  const result = await query(
    `SELECT notification_key, read_at, deleted_at, dismissed_at
     FROM office_notification_dismissals
     WHERE company_id = $1`,
    [companyId]
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.notification_key, {
      is_read: Boolean(row.read_at || row.dismissed_at),
      is_deleted: Boolean(row.deleted_at),
    });
  }
  return map;
}

export async function markNotificationRead(companyId, key) {
  if (!key) return;
  await query(
    `INSERT INTO office_notification_dismissals (company_id, notification_key, read_at, dismissed_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (company_id, notification_key)
     DO UPDATE SET read_at = NOW(), deleted_at = NULL, dismissed_at = NOW()`,
    [companyId, key]
  );
}

export async function markAllComputedRead(companyId) {
  const items = await buildComputedNotifications(companyId);
  if (items.length === 0) return;
  const keys = items.map((item) => item.id);
  await query(
    `INSERT INTO office_notification_dismissals (company_id, notification_key, read_at, dismissed_at)
     SELECT $1, unnest($2::text[]), NOW(), NOW()
     ON CONFLICT (company_id, notification_key)
     DO UPDATE SET read_at = NOW(), deleted_at = NULL, dismissed_at = NOW()`,
    [companyId, keys]
  );
}

/** Hide read computed alerts from inbox (user explicitly cleared them) */
export async function deleteReadComputed(companyId) {
  await query(
    `UPDATE office_notification_dismissals
     SET deleted_at = NOW()
     WHERE company_id = $1
       AND (read_at IS NOT NULL OR dismissed_at IS NOT NULL)
       AND deleted_at IS NULL`,
    [companyId]
  );
}

async function buildComputedNotifications(companyId) {
  const cached = computedCache.get(companyId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.items;
  }

  const items = [];
  const [vehicles, drivers, trips] = await Promise.all([
    query(
      `SELECT id, brand, model, plate, itp_expiry, rca_expiry, rovinieta_expiry, casco_expiry
       FROM vehicles
       WHERE company_id = $1 AND is_active = TRUE
         AND (
           itp_expiry <= CURRENT_DATE + 30
           OR rca_expiry <= CURRENT_DATE + 30
           OR rovinieta_expiry <= CURRENT_DATE + 30
           OR casco_expiry <= CURRENT_DATE + 30
         )`,
      [companyId]
    ),
    query(
      `SELECT id, name, license_expiry, medical_certificate_expiry, tachograph_card_expiry
       FROM drivers
       WHERE company_id = $1 AND is_active = TRUE
         AND (
           license_expiry <= CURRENT_DATE + 30
           OR medical_certificate_expiry <= CURRENT_DATE + 30
           OR tachograph_card_expiry <= CURRENT_DATE + 30
         )`,
      [companyId]
    ),
    query(
      `SELECT id, cmr_number FROM trips
       WHERE company_id = $1 AND status = 'planificata' AND driver_id IS NULL
       ORDER BY created_at DESC LIMIT 10`,
      [companyId]
    ),
  ]);

  for (const v of vehicles.rows) {
    const label = `${v.brand} ${v.model} (${v.plate})`;
    for (const doc of ['itp', 'rca', 'rovinieta', 'casco']) {
      const n = checkExpiry(v[`${doc}_expiry`], doc.toUpperCase(), label, '/vehicles');
      if (n) items.push(n);
    }
  }

  for (const d of drivers.rows) {
    const docs = [
      ['license_expiry', 'Permis', '/drivers'],
      ['medical_certificate_expiry', 'Medical', '/drivers'],
      ['tachograph_card_expiry', 'Tahograf', '/drivers'],
    ];
    for (const [field, label, link] of docs) {
      const n = checkExpiry(d[field], label, d.name, link);
      if (n) items.push(n);
    }
  }

  for (const t of trips.rows) {
    items.push({
      id: `computed:unassigned:${t.id}`,
      type: 'trip_unassigned',
      title: `Cursă nealocată — ${t.cmr_number || 'CMR'}`,
      message: 'Cursa este în așteptare. Alocă un șofer și vehicul.',
      link: `/trips/${t.id}`,
      trip_id: t.id,
      cmr_number: t.cmr_number,
      is_read: false,
      computed: true,
      created_at: new Date().toISOString(),
      created_date: new Date().toISOString(),
    });
  }

  items.push(...await dataIssueNotifications(companyId));

  computedCache.set(companyId, { at: Date.now(), items });
  return items;
}

/**
 * Only the errors reach the bell — the ones that end in a wrong invoice.
 *
 * The warnings live on `/checks`, where there is room to explain them. Putting all of them here
 * would bury the trip and document alerts the bell exists for.
 *
 * The findings share their key with the validation screen, so dismissing one dismisses it in
 * both places.
 */
async function dataIssueNotifications(companyId) {
  try {
    const { collectFindings } = await import('./validation/checks.js');
    const { findings } = await collectFindings(companyId);
    const now = new Date().toISOString();
    return findings
      .filter((item) => item.severity === 'error')
      .slice(0, 20)
      .map((item) => ({
        id: item.key,
        type: 'data_issue',
        title: item.title,
        message: item.message,
        link: item.link ?? '/checks',
        trip_id: item.subject?.type === 'trip' ? item.subject.id : null,
        cmr_number: null,
        is_read: false,
        computed: true,
        created_at: now,
        created_date: now,
      }));
  } catch (err) {
    // A failing check must not take the notification list down with it.
    console.error('[notifications] data checks failed', err);
    return [];
  }
}

export async function getComputedNotifications(companyId, dismissalState = new Map()) {
  const items = await buildComputedNotifications(companyId);
  return items
    .filter((item) => !dismissalState.get(item.id)?.is_deleted)
    .map((item) => ({
      ...item,
      is_read: Boolean(dismissalState.get(item.id)?.is_read),
    }));
}
