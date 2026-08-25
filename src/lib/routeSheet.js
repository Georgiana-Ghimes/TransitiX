/**
 * The road sheet ("foaie de parcurs") a driver takes with them.
 *
 * This module turns a route plan into the exact rows and labels that get printed, and
 * nothing else — no DOM, no PDF library. The renderer only walks the structure, so what
 * appears on paper is decided here, where it can be tested.
 *
 * It is a working document, not a fiscal one: the driver writes the real arrival time and
 * the recipient signs next to it, which is why every stop row ends with two empty boxes.
 */

import { formatDuration, formatEta, formatKm } from './dispatchUi.js';
import { toFiniteNumber } from './utils.js';

export const SHEET_COLUMNS = [
  { key: 'seq', label: 'Nr.', width: 5, align: 'center' },
  { key: 'eta', label: 'Ora est.', width: 9, align: 'center' },
  { key: 'name', label: 'Client / Locație', width: 20 },
  { key: 'address', label: 'Adresă', width: 26 },
  { key: 'order', label: 'Comandă', width: 13 },
  { key: 'load', label: 'Kg / Paleți', width: 11, align: 'right' },
  { key: 'window', label: 'Interval', width: 10, align: 'center' },
  { key: 'actual', label: 'Ora reală', width: 9 },
  { key: 'signature', label: 'Semnătură', width: 14 },
];

const KIND_LABELS = {
  livrare: 'Livrare',
  ridicare: 'Ridicare',
  depot_start: 'Plecare depozit',
  depot_end: 'Retur depozit',
  pauza: 'Pauză',
  repaus: 'Repaus',
};

function formatWindow(stop) {
  const from = String(stop.window_start || '').slice(0, 5);
  const to = String(stop.window_end || '').slice(0, 5);
  if (!from && !to) return '';
  return `${from || '…'}–${to || '…'}`;
}

function formatLoad(stop) {
  const kg = toFiniteNumber(stop.weight_kg);
  const pallets = toFiniteNumber(stop.pallets);
  const parts = [];
  if (kg) parts.push(`${kg.toLocaleString('ro-RO')} kg`);
  if (pallets) parts.push(`${pallets} pal`);
  return parts.join(' / ');
}

function formatDate(value) {
  const iso = String(value || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/**
 * Everything the printed sheet shows.
 *
 * A stop with no ETA prints an empty cell rather than a dash: the driver fills the real
 * time in anyway, and a fake estimate on a signed document is worse than no estimate.
 */
export function buildRouteSheet(plan, { company = null, date = null } = {}) {
  const route = plan?.route || {};
  const stops = plan?.stops || [];
  const totals = plan?.totals || {};
  const routeDate = date || route.route_date;

  const rows = stops.map((stop) => ({
    id: stop.id,
    seq: String(stop.seq ?? ''),
    eta: stop.planned_arrival ? formatEta(stop.planned_arrival) : '',
    name: stop.location_name || stop.client_name || KIND_LABELS[stop.kind] || 'Oprire',
    address: stop.address_full || [stop.address, stop.city].filter(Boolean).join(', '),
    order: stop.order_number || '',
    load: formatLoad(stop),
    window: formatWindow(stop),
    actual: '',
    signature: '',
    kind: KIND_LABELS[stop.kind] || '',
    notes: stop.access_notes || stop.notes || '',
  }));

  const meta = [
    { label: 'Șofer', value: route.driver_name || '—' },
    { label: 'Vehicul', value: route.vehicle_plate || '—' },
    { label: 'Plecare', value: String(route.starts_at || '08:00').slice(0, 5) },
    { label: 'Opriri', value: String(totals.stops ?? rows.length) },
    { label: 'Distanță', value: formatKm(totals.distance_km) },
    { label: 'Durată', value: formatDuration(totals.duration_min) },
  ];

  const load = [];
  if (toFiniteNumber(totals.weight_kg)) load.push(`${Number(totals.weight_kg).toLocaleString('ro-RO')} kg`);
  if (toFiniteNumber(totals.volume_mc)) load.push(`${Number(totals.volume_mc).toLocaleString('ro-RO')} mc`);
  if (toFiniteNumber(totals.pallets)) load.push(`${totals.pallets} paleți`);
  if (load.length) meta.push({ label: 'Încărcătură', value: load.join(' · ') });

  return {
    title: 'FOAIE DE PARCURS',
    company: company?.name || '',
    companyDetails: [company?.cui, company?.address, company?.phone].filter(Boolean).join(' · '),
    routeCode: route.code || '',
    date: formatDate(routeDate),
    meta,
    columns: SHEET_COLUMNS,
    rows,
    warnings: sheetWarnings(plan),
    filename: sheetFilename(route, routeDate),
    signatures: [
      { label: 'Dispecer', hint: 'nume și semnătură' },
      { label: 'Șofer', hint: 'nume și semnătură' },
    ],
    readings: [
      { label: 'Km plecare', value: '' },
      { label: 'Km sosire', value: '' },
      { label: 'Carburant alimentat', value: '' },
    ],
  };
}

/**
 * Rows are split into fixed-size pages rather than letting the renderer cut wherever the
 * paper ends — a stop sliced in half across two pages is a stop nobody signs.
 */
export const ROWS_PER_PAGE = 12;

export function paginateSheetRows(rows = [], perPage = ROWS_PER_PAGE) {
  if (!rows.length) return [[]];
  const size = Math.max(1, Math.trunc(perPage) || ROWS_PER_PAGE);
  const pages = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages;
}

/** Problems worth printing, so the driver leaves knowing about them. */
export function sheetWarnings(plan) {
  const out = [];
  const late = (plan?.windowViolations || []).filter((v) => v.type === 'intarziere');
  for (const violation of late) {
    out.push(`Oprirea ${violation.seq} depășește intervalul cu ${violation.by_min} min`);
  }
  for (const problem of plan?.capacityProblems || []) {
    out.push(`Depășire ${problem.label}: +${problem.over} ${problem.unit}`);
  }
  if (plan?.totals && plan.totals.complete === false) {
    out.push('Unele segmente nu au distanță calculată — orele estimate sunt incomplete');
  }
  return out;
}

export function sheetFilename(route = {}, date = null) {
  const iso = String(date || route.route_date || '').slice(0, 10) || 'fara-data';
  const code = String(route.code || 'ruta').replace(/[^\w-]+/g, '-');
  return `foaie-parcurs-${code}-${iso}.pdf`;
}
