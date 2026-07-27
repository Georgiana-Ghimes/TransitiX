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
  const existing = await query(
    `SELECT id FROM office_notifications
     WHERE company_id = $1 AND type = 'cmr_pending' AND trip_id = $2 AND is_read = FALSE
     LIMIT 1`,
    [companyId, trip.id]
  );
  if (existing.rows[0]) return;
  await createOfficeNotification({
    company_id: companyId,
    type: 'cmr_pending',
    title: `CMR de confirmat — ${trip.cmr_number || 'Cursă'}`,
    message: 'Șoferul a încărcat documentul CMR. Verifică datele OCR.',
    link: `/trips/${trip.id}`,
    trip_id: trip.id,
    cmr_number: trip.cmr_number,
  });
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
  for (const item of items) {
    await markNotificationRead(companyId, item.id);
  }
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
  const items = [];
  const [vehicles, drivers, trips] = await Promise.all([
    query(`SELECT * FROM vehicles WHERE company_id = $1 AND is_active = TRUE`, [companyId]),
    query(`SELECT * FROM drivers WHERE company_id = $1 AND is_active = TRUE`, [companyId]),
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

  return items;
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
