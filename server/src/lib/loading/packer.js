/**
 * 3D extreme-point bin packer for a truck cargo bay.
 *
 * Coordinates (metres):
 *   x — nose (cab) → rear door
 *   y — left → right
 *   z — floor → roof
 *
 * Driver-friendly (LIFO): last delivery is loaded first and ends up toward the nose,
 * so the first stop of the day is near the door. Warehouse-friendly groups by picking
 * zone / SKU before packing.
 */

const EPS = 1e-6;

/** EUR pallet footprint when an order has no product dimensions. */
export const DEFAULT_PALLET = { length_m: 1.2, width_m: 0.8, height_m: 1.5, weight_kg: 500 };

/** Assumed EU curtainsider when the vehicle has no cargo_* fields. */
export const DEFAULT_BAY = {
  length_m: 13.6,
  width_m: 2.45,
  height_m: 2.7,
  axle_front_m: 1.2,
  axle_rear_m: 10.5,
  axle_front_max_kg: 8000,
  axle_rear_max_kg: 16000,
  assumed: true,
};

export function resolveCargoBay(vehicle = {}) {
  const length = num(vehicle.cargo_length_m);
  const width = num(vehicle.cargo_width_m);
  const height = num(vehicle.cargo_height_m);
  if (length && width && height) {
    return {
      length_m: length,
      width_m: width,
      height_m: height,
      axle_front_m: num(vehicle.axle_front_m) ?? length * 0.1,
      axle_rear_m: num(vehicle.axle_rear_m) ?? length * 0.75,
      axle_front_max_kg: num(vehicle.axle_front_max_kg),
      axle_rear_max_kg: num(vehicle.axle_rear_max_kg),
      assumed: false,
    };
  }
  return { ...DEFAULT_BAY };
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBox(p) {
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    l: p.l ?? p.length_m,
    w: p.w ?? p.width_m,
    h: p.h ?? p.height_m,
  };
}

function overlaps(a, b) {
  const A = asBox(a);
  const B = asBox(b);
  return (
    A.x < B.x + B.l - EPS
    && A.x + A.l > B.x + EPS
    && A.y < B.y + B.w - EPS
    && A.y + A.w > B.y + EPS
    && A.z < B.z + B.h - EPS
    && A.z + A.h > B.z + EPS
  );
}

function fitsInBay(box, bay) {
  return (
    box.x >= -EPS
    && box.y >= -EPS
    && box.z >= -EPS
    && box.x + box.l <= bay.length_m + EPS
    && box.y + box.w <= bay.width_m + EPS
    && box.z + box.h <= bay.height_m + EPS
  );
}

/**
 * Turn route stops / orders into packable boxes.
 * One EUR-like unit per pallet, or one unit from volume when pallets is 0.
 */
export function itemsFromStops(stops = [], { productsById = {} } = {}) {
  const items = [];
  for (const stop of stops) {
    if (!stop || ['depot_start', 'depot_end', 'pauza', 'repaus'].includes(stop.kind)) continue;
    const product = stop.product_id ? productsById[stop.product_id] : null;
    const pallets = Math.max(0, Math.round(Number(stop.pallets) || 0));
    const volume = Number(stop.volume_mc) || 0;
    const weight = Number(stop.weight_kg) || 0;

    let count = pallets;
    if (!count && volume > 0) {
      const unitVol = product
        ? (Number(product.length_m) || DEFAULT_PALLET.length_m)
          * (Number(product.width_m) || DEFAULT_PALLET.width_m)
          * (Number(product.height_m) || DEFAULT_PALLET.height_m)
        : DEFAULT_PALLET.length_m * DEFAULT_PALLET.width_m * DEFAULT_PALLET.height_m;
      count = Math.max(1, Math.ceil(volume / unitVol));
    }
    if (!count && weight > 0) count = Math.max(1, Math.ceil(weight / DEFAULT_PALLET.weight_kg));
    if (!count) continue;

    const l = num(product?.length_m) || DEFAULT_PALLET.length_m;
    const w = num(product?.width_m) || DEFAULT_PALLET.width_m;
    const h = num(product?.height_m) || DEFAULT_PALLET.height_m;
    const unitW = num(product?.unit_weight_kg)
      || (weight > 0 ? weight / count : DEFAULT_PALLET.weight_kg);
    const stackable = product?.stackable !== false;

    for (let i = 0; i < count; i += 1) {
      items.push({
        id: `${stop.id || stop.order_id || 's'}-${i}`,
        stop_id: stop.id || null,
        stop_seq: Number(stop.seq) || 0,
        order_id: stop.order_id || null,
        order_number: stop.order_number || null,
        sku: product?.sku || null,
        picking_zone: product?.picking_zone || null,
        length_m: l,
        width_m: w,
        height_m: h,
        weight_kg: unitW,
        stackable,
      });
    }
  }
  return items;
}

/**
 * Sort items for a packing strategy.
 * @param {'lifo'|'warehouse'} strategy
 */
export function orderItems(items, strategy = 'lifo') {
  const list = [...items];
  if (strategy === 'warehouse') {
    list.sort((a, b) => {
      const za = String(a.picking_zone || '');
      const zb = String(b.picking_zone || '');
      if (za !== zb) return za.localeCompare(zb);
      const sa = String(a.sku || '');
      const sb = String(b.sku || '');
      if (sa !== sb) return sa.localeCompare(sb);
      return (b.stop_seq || 0) - (a.stop_seq || 0);
    });
    return list;
  }
  // LIFO: higher stop seq (later delivery) packed first → toward the nose.
  list.sort((a, b) => (b.stop_seq || 0) - (a.stop_seq || 0) || String(a.id).localeCompare(String(b.id)));
  return list;
}

function rotations(item) {
  const { length_m: L, width_m: W, height_m: H } = item;
  const opts = [
    { l: L, w: W, h: H },
    { l: W, w: L, h: H },
  ];
  // Deduplicate identical footprints.
  const seen = new Set();
  return opts.filter((o) => {
    const key = `${o.l}x${o.w}x${o.h}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function supportedFromBelow(box, placed, stackable) {
  if (box.z <= EPS) return true;
  if (!stackable) return false;
  // Need enough contact area on top of something below.
  let support = 0;
  const area = box.l * box.w;
  for (const raw of placed) {
    const p = asBox(raw);
    if (Math.abs((p.z + p.h) - box.z) > 0.02) continue;
    const ox = Math.max(0, Math.min(box.x + box.l, p.x + p.l) - Math.max(box.x, p.x));
    const oy = Math.max(0, Math.min(box.y + box.w, p.y + p.w) - Math.max(box.y, p.y));
    support += ox * oy;
  }
  return support >= area * 0.5 - EPS;
}

/**
 * Pack items into the bay. Returns placements, unplaced leftovers, fill metrics, axle loads.
 */
export function packItems(items, vehicle, { strategy = 'lifo' } = {}) {
  const bay = resolveCargoBay(vehicle);
  const ordered = orderItems(items, strategy);
  const placed = [];
  const unplaced = [];
  let extremePoints = [{ x: 0, y: 0, z: 0 }];

  const collides = (box) => placed.some((p) => overlaps(box, p));

  for (const item of ordered) {
    let best = null;

    for (const rot of rotations(item)) {
      for (const ep of extremePoints) {
        const box = {
          x: ep.x, y: ep.y, z: ep.z,
          l: rot.l, w: rot.w, h: rot.h,
        };
        if (!fitsInBay(box, bay)) continue;
        if (collides(box)) continue;
        if (!supportedFromBelow(box, placed, item.stackable)) continue;

        const score = box.z * 1e6 + box.y * 1e3 + box.x;
        if (!best || score < best.score) {
          best = { score, box, item, rot };
        }
      }
    }

    if (!best) {
      unplaced.push(item);
      continue;
    }

    const placement = {
      ...best.item,
      x: best.box.x,
      y: best.box.y,
      z: best.box.z,
      length_m: best.box.l,
      width_m: best.box.w,
      height_m: best.box.h,
    };
    placed.push(placement);

    // New extreme points from the three positive faces.
    const candidates = [
      { x: best.box.x + best.box.l, y: best.box.y, z: best.box.z },
      { x: best.box.x, y: best.box.y + best.box.w, z: best.box.z },
      { x: best.box.x, y: best.box.y, z: best.box.z + best.box.h },
    ];
    extremePoints = [...extremePoints, ...candidates]
      .filter((p) => (
        p.x < bay.length_m - EPS
        && p.y < bay.width_m - EPS
        && p.z < bay.height_m - EPS
      ));
    // Dedupe
    const seen = new Set();
    extremePoints = extremePoints.filter((p) => {
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const usedVolume = placed.reduce((s, p) => s + p.length_m * p.width_m * p.height_m, 0);
  const bayVolume = bay.length_m * bay.width_m * bay.height_m;
  const usedWeight = placed.reduce((s, p) => s + (Number(p.weight_kg) || 0), 0);
  const axle = computeAxleLoads(placed, bay);

  return {
    strategy,
    bay,
    placements: placed,
    unplaced,
    fill: {
      volume_ratio: bayVolume > 0 ? Math.round((usedVolume / bayVolume) * 1000) / 1000 : 0,
      volume_pct: bayVolume > 0 ? Math.round((usedVolume / bayVolume) * 1000) / 10 : 0,
      used_volume_mc: Math.round(usedVolume * 1000) / 1000,
      bay_volume_mc: Math.round(bayVolume * 1000) / 1000,
      used_weight_kg: Math.round(usedWeight * 10) / 10,
      placed_count: placed.length,
      unplaced_count: unplaced.length,
    },
    axle,
  };
}

/**
 * Two-axle lever model along cargo length. Item mass acts at its geometric centre.
 */
export function computeAxleLoads(placements, bay) {
  const F = Number(bay.axle_front_m);
  const R = Number(bay.axle_rear_m);
  const span = R - F;
  let front = 0;
  let rear = 0;

  if (!(span > EPS)) {
    const half = placements.reduce((s, p) => s + (Number(p.weight_kg) || 0), 0) / 2;
    return {
      front_kg: Math.round(half * 10) / 10,
      rear_kg: Math.round(half * 10) / 10,
      front_max_kg: bay.axle_front_max_kg ?? null,
      rear_max_kg: bay.axle_rear_max_kg ?? null,
      warnings: ['Pozițiile axelor nu sunt configurate — sarcina e împărțită egal.'],
    };
  }

  for (const p of placements) {
    const m = Number(p.weight_kg) || 0;
    const xCom = p.x + p.length_m / 2;
    // Clamp to axle span for numerical stability at the door/nose overhang.
    const x = Math.min(R, Math.max(F, xCom));
    const rearShare = ((x - F) / span) * m;
    const frontShare = m - rearShare;
    front += frontShare;
    rear += rearShare;
  }

  const warnings = [];
  const frontMax = bay.axle_front_max_kg != null ? Number(bay.axle_front_max_kg) : null;
  const rearMax = bay.axle_rear_max_kg != null ? Number(bay.axle_rear_max_kg) : null;
  if (frontMax != null && front > frontMax + EPS) {
    warnings.push(`Axa față: ${Math.round(front)} kg > limită ${frontMax} kg`);
  }
  if (rearMax != null && rear > rearMax + EPS) {
    warnings.push(`Axa spate: ${Math.round(rear)} kg > limită ${rearMax} kg`);
  }

  return {
    front_kg: Math.round(front * 10) / 10,
    rear_kg: Math.round(rear * 10) / 10,
    front_max_kg: frontMax,
    rear_max_kg: rearMax,
    warnings,
  };
}

/**
 * Side-view rectangles for the UI: project placements onto the length×height plane.
 */
export function sideViewRects(placements = []) {
  return placements.map((p) => ({
    id: p.id,
    stop_seq: p.stop_seq,
    order_number: p.order_number,
    x: p.x,
    z: p.z,
    length_m: p.length_m,
    height_m: p.height_m,
    weight_kg: p.weight_kg,
  }));
}

/** Default number of compartments a cargo bay is shown as. */
export const DEFAULT_SEGMENTS = 6;

/** Length of overlap between [aFrom,aTo] and [bFrom,bTo]. */
function overlapLength(aFrom, aTo, bFrom, bTo) {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

/**
 * Fill per compartment along the bay length — the numbered bars above the truck profile.
 *
 * A pallet straddling two compartments is split by how much of it lies in each, rather than
 * being credited entirely to whichever compartment its origin falls in. Otherwise the bars
 * lie whenever the load is not neatly aligned to the compartment grid.
 */
export function segmentFill(placements = [], bay, { count = DEFAULT_SEGMENTS } = {}) {
  const length = Number(bay?.length_m);
  const width = Number(bay?.width_m);
  const height = Number(bay?.height_m);
  const n = Math.max(1, Math.trunc(count));
  if (!(length > 0) || !(width > 0) || !(height > 0)) return [];

  const step = length / n;
  const segments = [];

  for (let i = 0; i < n; i += 1) {
    const from = i * step;
    const to = from + step;
    const segmentVolume = step * width * height;
    let usedVolume = 0;
    let weight = 0;
    const stops = new Set();
    let items = 0;

    for (const p of placements) {
      const share = overlapLength(p.x, p.x + p.length_m, from, to);
      if (share <= 0) continue;
      const fraction = p.length_m > 0 ? share / p.length_m : 0;
      usedVolume += share * p.width_m * p.height_m;
      weight += (Number(p.weight_kg) || 0) * fraction;
      if (p.stop_seq != null) stops.add(p.stop_seq);
      items += 1;
    }

    segments.push({
      index: i,
      // FleetLoader numbers compartments 001, 002, … — kept because crews read them aloud.
      label: String(i + 1).padStart(3, '0'),
      from_m: Math.round(from * 1000) / 1000,
      to_m: Math.round(to * 1000) / 1000,
      volume_pct: segmentVolume > 0 ? Math.round((usedVolume / segmentVolume) * 1000) / 10 : 0,
      weight_kg: Math.round(weight * 10) / 10,
      item_count: items,
      stops: [...stops].sort((a, b) => a - b),
    });
  }

  return segments;
}

/**
 * Weight carried on each side of the centre line.
 *
 * y = 0 is the driver's side (left, for right-hand traffic). Items crossing the centre line
 * are split proportionally. A large imbalance is a real handling and enforcement problem,
 * not a cosmetic one, so it is reported as its own number.
 */
export function lateralBalance(placements = [], bay) {
  const width = Number(bay?.width_m);
  if (!(width > 0)) return { driver_kg: 0, passenger_kg: 0, total_kg: 0, imbalance_kg: 0, imbalance_pct: 0 };

  const mid = width / 2;
  let driver = 0;
  let passenger = 0;

  for (const p of placements) {
    const weight = Number(p.weight_kg) || 0;
    if (!(p.width_m > 0)) continue;
    const left = overlapLength(p.y, p.y + p.width_m, 0, mid) / p.width_m;
    driver += weight * left;
    passenger += weight * (1 - left);
  }

  const total = driver + passenger;
  const imbalance = Math.abs(driver - passenger);
  return {
    driver_kg: Math.round(driver * 10) / 10,
    passenger_kg: Math.round(passenger * 10) / 10,
    total_kg: Math.round(total * 10) / 10,
    imbalance_kg: Math.round(imbalance * 10) / 10,
    imbalance_pct: total > 0 ? Math.round((imbalance / total) * 1000) / 10 : 0,
  };
}
