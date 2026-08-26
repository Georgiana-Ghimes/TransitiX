/**
 * Display logic for the load planner.
 *
 * The screen answers one question — "what is on this truck, and where" — so everything that
 * turns packer output into something a loader can act on lives here, pure and tested.
 */

import { toFiniteNumber } from './utils.js';

/** Stop colours, shared by the profile, the side view and the item grid so they agree. */
export const STOP_COLORS = [
  '#1D4E89', '#27AE60', '#E67E22', '#8E44AD', '#16A085', '#C0392B', '#2980B9', '#F39C12',
];

export function stopColor(seq) {
  const n = toFiniteNumber(seq);
  if (n == null) return '#94A3B8';
  return STOP_COLORS[Math.abs(Math.trunc(n)) % STOP_COLORS.length];
}

/**
 * Colour for a compartment fill bar.
 * Over-full is red because it means the packer could not honour the bay, not "very good".
 */
export function fillColor(pct) {
  const value = toFiniteNumber(pct) ?? 0;
  if (value > 100) return '#C0392B';
  if (value >= 85) return '#27AE60';
  if (value >= 50) return '#1D4E89';
  if (value > 0) return '#F5A623';
  return '#E2E8F0';
}

export function formatPct(value) {
  const num = toFiniteNumber(value);
  return num == null ? '—' : `${Math.round(num)}%`;
}

export function formatKg(value) {
  const num = toFiniteNumber(value);
  if (num == null) return '—';
  return `${num.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} kg`;
}

export function formatMeters(value) {
  const num = toFiniteNumber(value);
  return num == null ? '—' : `${num.toLocaleString('ro-RO', { maximumFractionDigits: 2 })} m`;
}

/** Vehicles matching a free-text search on plate, brand, model or chassis. */
export function filterVehicles(vehicles = [], search = '') {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return vehicles;
  return vehicles.filter((v) => [v.plate, v.brand, v.model, v.chassis_number]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle)));
}

/** "Mercedes-Benz Actros" — what the crew calls the truck. */
export function vehicleModelLabel(vehicle) {
  return [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ') || '—';
}

/**
 * Groups placements by stop, in loading order.
 *
 * The layer panel is read while loading, so stops come back in the order they are put on the
 * truck (highest sequence first under LIFO), not in delivery order.
 */
export function groupByStop(placements = []) {
  const groups = new Map();
  for (const p of placements) {
    const seq = toFiniteNumber(p.stop_seq) ?? 0;
    if (!groups.has(seq)) {
      groups.set(seq, {
        stop_seq: seq,
        order_number: p.order_number || null,
        items: [],
        weight_kg: 0,
        volume_mc: 0,
      });
    }
    const group = groups.get(seq);
    group.items.push(p);
    group.weight_kg += toFiniteNumber(p.weight_kg) ?? 0;
    group.volume_mc += (toFiniteNumber(p.length_m) ?? 0)
      * (toFiniteNumber(p.width_m) ?? 0)
      * (toFiniteNumber(p.height_m) ?? 0);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      weight_kg: Math.round(g.weight_kg * 10) / 10,
      volume_mc: Math.round(g.volume_mc * 1000) / 1000,
      item_count: g.items.length,
    }))
    .sort((a, b) => b.stop_seq - a.stop_seq);
}

/**
 * One row per distinct article, the way the bottom grid in FleetLoader reads.
 * Individual pallets are packed separately but a loader wants "12 × LWMB 0.75 for stop 26".
 */
export function itemRows(placements = []) {
  const rows = new Map();
  for (const p of placements) {
    const key = [p.stop_seq, p.order_number, p.sku || 'palet'].join('|');
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        sku: p.sku || null,
        stop_seq: toFiniteNumber(p.stop_seq) ?? 0,
        order_number: p.order_number || null,
        picking_zone: p.picking_zone || null,
        quantity: 0,
        weight_kg: 0,
      });
    }
    const row = rows.get(key);
    row.quantity += 1;
    row.weight_kg += toFiniteNumber(p.weight_kg) ?? 0;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, weight_kg: Math.round(r.weight_kg * 10) / 10 }))
    .sort((a, b) => a.stop_seq - b.stop_seq
      || String(a.sku || '').localeCompare(String(b.sku || ''), 'ro'));
}

/** True when nothing in the load carries the fields the warehouse strategy sorts by. */
export function strategyIsIndistinguishable(plan) {
  const all = [...(plan?.placements || []), ...(plan?.unplaced || [])];
  if (!all.length) return false;
  return !all.some((item) => item.sku || item.picking_zone);
}

/** Everything worth shouting about, worst first. */
export function loadWarnings(plan) {
  const out = [];
  if (!plan) return out;

  const unplaced = plan.unplaced?.length || 0;
  if (unplaced) {
    out.push({
      level: 'error',
      text: `${unplaced} ${unplaced === 1 ? 'colet nu încape' : 'colete nu încap'} în vehicul`,
    });
  }

  for (const axle of ['front', 'rear']) {
    const load = toFiniteNumber(plan.axle?.[`${axle}_kg`]);
    const max = toFiniteNumber(plan.axle?.[`${axle}_max_kg`]);
    if (load != null && max != null && max > 0 && load > max) {
      out.push({
        level: 'error',
        text: `Axa ${axle === 'front' ? 'față' : 'spate'} depășită cu ${Math.round(load - max)} kg`,
      });
    }
  }

  const imbalance = toFiniteNumber(plan.balance?.imbalance_pct);
  // Above roughly a fifth the truck pulls noticeably and a roadside check will spot it.
  if (imbalance != null && imbalance > 20) {
    out.push({ level: 'warn', text: `Încărcare dezechilibrată lateral: ${formatPct(imbalance)}` });
  }

  // The warehouse strategy sorts by picking zone then SKU. With neither present it falls
  // through to the same tiebreaker as LIFO, so the toggle appears to do nothing — say why
  // rather than letting it look broken.
  if (strategyIsIndistinguishable(plan)) {
    out.push({
      level: 'warn',
      text: 'Comenzile nu au SKU sau zonă de picking — „Ordine depozit" dă același rezultat ca „Ordine șofer"',
    });
  }

  if (plan.bay?.assumed) {
    out.push({
      level: 'warn',
      text: 'Dimensiunile cutiei sunt presupuse — completează cargo_length/width/height pe vehicul',
    });
  }

  return out;
}
