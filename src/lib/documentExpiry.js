/**
 * One reading of "which documents are expiring" for the whole office UI.
 *
 * Dashboard, Documente and the notification bell used to each count this differently — different
 * horizons, different rules about inactive fleet — so the same day could show 5 alerts on one
 * screen and 3 on another. The bell computes server-side (`server/src/lib/officeNotifications.js`)
 * against the same setting and the same is_active rule; this module is its client twin.
 */
export const DEFAULT_EXPIRY_HORIZON_DAYS = 30;

const VEHICLE_DOCS = [
  { type: 'ITP', numberField: 'itp_number', dateField: 'itp_expiry' },
  { type: 'RCA', numberField: 'rca_number', dateField: 'rca_expiry' },
  { type: 'Rovinietă', numberField: 'rovinieta_number', dateField: 'rovinieta_expiry' },
  { type: 'CASCO', numberField: 'casco_number', dateField: 'casco_expiry' },
];

const DRIVER_DOCS = [
  { type: 'Permis', numberField: 'license_number', dateField: 'license_expiry' },
  { type: 'Medical', numberField: 'medical_certificate_number', dateField: 'medical_certificate_expiry' },
  { type: 'Tahograf', numberField: 'tachograph_card_number', dateField: 'tachograph_card_expiry' },
];

/** Widest threshold the company configured in Setări. */
export function expiryHorizonDays(company) {
  const days = company?.settings?.document_expiry_days;
  if (!Array.isArray(days)) return DEFAULT_EXPIRY_HORIZON_DAYS;
  const usable = days.map(Number).filter((d) => Number.isFinite(d) && d > 0);
  return usable.length > 0 ? Math.max(...usable) : DEFAULT_EXPIRY_HORIZON_DAYS;
}

export function vehicleLabel(v) {
  return [v?.brand, v?.model].filter(Boolean).join(' ') + (v?.plate ? ` (${v.plate})` : '');
}

function pushDocs(list, { docs, source, entity, entityType, entityId, horizonEnd, now }) {
  for (const doc of docs) {
    const raw = source[doc.dateField];
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime()) || date > horizonEnd) continue;
    list.push({
      key: `${entityType}:${entityId}:${doc.type}:${String(raw).slice(0, 10)}`,
      entityId,
      entityType,
      entity,
      type: doc.type,
      number: source[doc.numberField] || null,
      date: raw,
      expired: date < now,
    });
  }
}

export function collectExpiringDocuments({
  vehicles = [],
  drivers = [],
  horizonDays = DEFAULT_EXPIRY_HORIZON_DAYS,
  now = new Date(),
} = {}) {
  const horizonEnd = new Date(now);
  horizonEnd.setDate(now.getDate() + horizonDays);
  const list = [];

  for (const v of vehicles) {
    if (v?.is_active === false) continue;
    pushDocs(list, {
      docs: VEHICLE_DOCS,
      source: v,
      entity: vehicleLabel(v),
      entityType: 'vehicle',
      entityId: v.id,
      horizonEnd,
      now,
    });
  }

  for (const d of drivers) {
    if (d?.is_active === false) continue;
    pushDocs(list, {
      docs: DRIVER_DOCS,
      source: d,
      entity: d.name,
      entityType: 'driver',
      entityId: d.id,
      horizonEnd,
      now,
    });
  }

  return list.sort((a, b) => new Date(a.date) - new Date(b.date));
}
