/**
 * Turning the trail into something a person reads.
 *
 * The server stores column names and raw values because that is what is true. A screen that
 * shows `tarif_km: 2.5000 → 2.8000` next to `default_depot_location_id` is technically complete
 * and practically useless, so the translation happens here — and falls back to a humanised
 * column name rather than hiding a field it does not recognise. A trail with holes in it is
 * exactly the thing this feature exists to avoid.
 */

export const ACTIONS = {
  create: { label: 'Creat', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: 'Modificat', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  delete: { label: 'Șters', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  login: { label: 'Autentificare', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  login_failed: { label: 'Autentificare eșuată', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  logout: { label: 'Deconectare', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
  sessions_revoked: { label: 'Sesiuni încheiate', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  export: { label: 'Export', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  import: { label: 'Import', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  run: { label: 'Rulare', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function actionMeta(action) {
  return ACTIONS[action] || { label: action || '—', badge: 'bg-slate-100 text-slate-600 border-slate-200' };
}

/** Entity names as they appear on screen elsewhere in the app. */
export const ENTITY_LABELS = {
  Contract: 'Contract',
  ContractTariff: 'Tarif contractual',
  TaxZone: 'Zonă',
  TaxZoneRate: 'Taxă de zonă',
  SurchargeType: 'Tip taxă suplimentară',
  SurchargeRate: 'Taxă suplimentară',
  ObservationCode: 'Cod observație',
  Location: 'Locație',
  Client: 'Client',
  Vehicle: 'Vehicul',
  Driver: 'Șofer',
  Trip: 'Cursă',
  TripCharge: 'Componentă TPO',
  TripLeg: 'Etapă cursă',
  Invoice: 'Factură',
  ReportTemplate: 'Șablon raport',
  Territory: 'Teritoriu',
  Order: 'Comandă',
  WarehouseProduct: 'Produs depozit',
  User: 'Utilizator',
  Depot: 'Garaj',
  Session: 'Sesiune',
};

export function entityLabel(entity) {
  return ENTITY_LABELS[entity] || entity || '—';
}

/** The columns worth naming properly; everything else is humanised from the column itself. */
const FIELD_LABELS = {
  tarif_km: 'Tarif pe km',
  tarif_cursa: 'Tarif cursă',
  vehicle_class: 'Clasă vehicul',
  mma_kg: 'MMA (kg)',
  valid_from: 'Valabil de la',
  valid_to: 'Valabil până la',
  distance_km: 'Distanță (km)',
  distance_source: 'Sursă distanță',
  tpo_number: 'Număr TPO',
  tpo_total: 'Total TPO',
  cmr_number: 'Număr CMR',
  data_efectuare_cursa: 'Data cursei',
  data_facturare: 'Data facturării',
  uit_code: 'Cod UIT',
  default_depot_location_id: 'Garaj',
  is_active: 'Activ',
  unit_amount: 'Preț unitar',
};

/**
 * A readable name for a column.
 *
 * Unknown columns are humanised rather than dropped: showing `some_new_column` is worse than a
 * proper label and far better than silently omitting a change somebody made.
 */
export function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return String(field || '')
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** A value as text, keeping "empty" visibly different from zero. */
export function formatValue(value) {
  if (value == null || value === '') return '—';
  if (value === true) return 'Da';
  if (value === false) return 'Nu';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  // Timestamps come back as ISO; the date alone is what a reader wants.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  // NUMERIC arrives as "2.5000" — trailing zeros are formatting, not information.
  if (/^-?\d+\.\d+$/.test(text)) return String(Number(text));
  return text;
}

/**
 * The changes on one event, as rows.
 *
 * A create or a delete stores the whole row rather than a from/to pair, so both shapes have to
 * be handled: `{field: value}` and `{field: {from, to}}`.
 */
export function changeRows(event) {
  const changes = event?.changes;
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes)
    .map(([field, value]) => {
      const paired = value && typeof value === 'object' && ('from' in value || 'to' in value);
      return {
        field,
        label: fieldLabel(field),
        from: paired ? value.from : undefined,
        to: paired ? value.to : value,
        paired,
      };
    })
    // Empty values on a create or delete are noise; a cleared field on an update is the point.
    .filter((row) => row.paired || (row.to != null && row.to !== ''))
    .sort((a, b) => a.label.localeCompare(b.label, 'ro'));
}

/** One line: who did what to which record. */
export function describeEvent(event) {
  const who = event?.user?.name || event?.user?.email || 'Utilizator șters';
  const what = actionMeta(event?.action).label.toLowerCase();
  const subject = event?.label
    ? `${entityLabel(event?.entity)} „${event.label}"`
    : entityLabel(event?.entity);
  return `${who} a ${what} ${subject}`;
}

/** Events bucketed by calendar day, newest day first, order preserved inside a day. */
export function groupByDay(events) {
  const days = [];
  const index = new Map();
  for (const event of events || []) {
    const day = String(event.created_at || '').slice(0, 10);
    if (!index.has(day)) {
      index.set(day, { day, events: [] });
      days.push(index.get(day));
    }
    index.get(day).events.push(event);
  }
  return days;
}

/** Local time, to the minute — the trail is read by people, not parsed. */
export function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(day) {
  if (!day) return '';
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('ro-RO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
