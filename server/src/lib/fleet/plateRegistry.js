/**
 * Opening a vehicle record from a plate an aviz carried.
 *
 * The Bucharest zone tax is charged on MTMA, which is a fact about the lorry and lives on
 * `vehicles.mma_kg`. An aviz only carries `numar_auto` as free text, so until now the documents
 * flow had no way to reach that figure at all and the operator typed the fee by hand into
 * "Taxe suplimentare". This is the missing link: every plate the OCR reads opens a record, and
 * the office fills in the MTMA once per lorry instead of once per trip.
 *
 * Rows opened this way are marked `added_by_ocr`, because a misread plate produces a lorry that
 * never existed. The screen has to be able to say "this one arrived by itself" rather than
 * presenting it as fleet somebody entered.
 */
import { canonicalPlate, isAcceptableAutoField } from '../ocr/fields.js';

/** Split `B-29-NKL` / `CA-4471-KX` into county, digits, series. */
export function plateParts(plate) {
  const m = String(plate || '').trim().toUpperCase().match(
    /^([A-Z]{1,2})-(\d{2,4})-([A-Z]{2,3})$/,
  );
  if (!m) return null;
  return { county: m[1], num: m[2], series: m[3] };
}

/** Hamming distance on equal-length digit strings. */
export function digitEditDistance(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return 99;
  let d = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) d += 1;
  }
  return d;
}

/**
 * Night / noisy OCR often flips one digit on the tractor (`B-29-NKL` → `B-23-NKL`, 9→3) (#78).
 * If the OCR primary is unknown but exactly one active fleet plate shares county+series and
 * differs by a single digit, prefer the fleet plate. Ambiguous (0 or 2+ neighbours) → no change.
 */
export function pickFleetPlateCorrection(ocrPrimary, fleetPlates) {
  const ocr = plateParts(ocrPrimary);
  if (!ocr) return null;
  const fleet = (Array.isArray(fleetPlates) ? fleetPlates : [])
    .map((p) => plateParts(p))
    .filter((p) => p && p.county === ocr.county && p.series === ocr.series && p.num.length === ocr.num.length);
  if (!fleet.length) return null;
  if (fleet.some((p) => p.num === ocr.num)) return null;
  const near = fleet.filter((p) => digitEditDistance(p.num, ocr.num) === 1);
  if (near.length !== 1) return null;
  return `${near[0].county}-${near[0].num}-${near[0].series}`;
}

/**
 * Rewrite `B-23-NKL / B-81-NKL` → `B-29-NKL / B-81-NKL` when the tractor matches the fleet (#78).
 */
export function applyFleetPlateCorrection(numarAuto, fleetPlates) {
  const canonical = canonicalPlate(numarAuto);
  if (!canonical) {
    return { numarAuto: numarAuto || null, repaired: false, from: null, to: null };
  }
  const parts = canonical.split('/').map((s) => s.trim()).filter(Boolean);
  const primary = parts[0];
  const corrected = pickFleetPlateCorrection(primary, fleetPlates);
  if (!corrected || corrected === primary) {
    return { numarAuto: canonical, repaired: false, from: null, to: null };
  }
  const next = [corrected, ...parts.slice(1)].join(' / ');
  return { numarAuto: next, repaired: true, from: primary, to: corrected };
}

/**
 * The plate to open a record for: the first one, and only if it really is a plate.
 *
 * An aviz writes `B-112-VFM / B-475-AGR`, tractor then trailer, and the customer's own annex
 * carries only the first. Registering the trailer too would create a second record that can
 * never be given an MTMA of its own: for an articulated vehicle the figure that matters is the
 * combination's, and it sits on the tractor's registration.
 *
 * The validity check is not belt-and-braces. `canonicalPlate` deliberately hands back text it
 * does not recognise, so the plate backfill cannot destroy the fleet's non-standard entries —
 * which means a line of OCR prose like "330 SRS FOOTY STREAM" comes through it unchanged and
 * would open a lorry that never existed. A phantom then asks for an MTMA forever, and an alert
 * nobody can clear is an alert everybody learns to ignore.
 */
export function primaryPlate(value) {
  const canonical = canonicalPlate(value);
  if (!canonical) return null;
  const first = canonical.split('/')[0].trim();
  if (!first || !isAcceptableAutoField(first)) return null;
  return first;
}

/**
 * Against Autoturisme: if OCR misread one digit on the tractor, prefer the known plate (#78).
 * Loads only active vehicles sharing county + letter series (small set).
 */
export async function resolveOcrPlateAgainstFleet(db, companyId, numarAuto) {
  const primary = primaryPlate(numarAuto);
  if (!primary || !companyId) {
    return applyFleetPlateCorrection(numarAuto, []);
  }
  const parts = plateParts(primary);
  if (!parts) return applyFleetPlateCorrection(numarAuto, []);

  const res = await db.query(
    `SELECT plate FROM vehicles
     WHERE company_id = $1
       AND is_active IS NOT FALSE
       AND upper(btrim(plate)) LIKE $2`,
    [companyId, `${parts.county}-%-${parts.series}`],
  );
  return applyFleetPlateCorrection(numarAuto, res.rows.map((r) => r.plate));
}

/**
 * Finds the vehicle for a plate, or opens a record for it.
 *
 * Serialised on the company row rather than on a unique index, the same way `ensureTemplates`
 * does: two documents extracted at once carry the same lorry often enough that the race is
 * real, and the fleet holds deliberate non-standard plates that a unique index over existing
 * data could not be added under without a cleanup nobody asked for.
 *
 * Returns `{ vehicle, created }` so the caller can report what it did. Never throws on a plate
 * it cannot use: an extraction must not fail because a lorry could not be filed.
 *
 * Resolves OCR digit slips against the fleet first (#78), so we do not invent a phantom
 * `B-23-NKL` when `B-29-NKL` is already on Autoturisme.
 */
export async function ensureVehicleForPlate(client, companyId, numarAuto) {
  const resolved = await resolveOcrPlateAgainstFleet(client, companyId, numarAuto);
  const plate = primaryPlate(resolved.numarAuto);
  if (!plate) return { vehicle: null, created: false, repaired: false, numarAuto: resolved.numarAuto };

  await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);

  const existing = await client.query(
    'SELECT * FROM vehicles WHERE company_id = $1 AND upper(btrim(plate)) = upper($2) LIMIT 1',
    [companyId, plate],
  );
  if (existing.rows[0]) {
    return {
      vehicle: existing.rows[0],
      created: false,
      repaired: resolved.repaired,
      numarAuto: resolved.numarAuto,
    };
  }

  const inserted = await client.query(
    `INSERT INTO vehicles (company_id, plate, added_by_ocr, is_active)
     VALUES ($1, $2, TRUE, TRUE)
     RETURNING *`,
    [companyId, plate],
  );
  return {
    vehicle: inserted.rows[0],
    created: true,
    repaired: resolved.repaired,
    numarAuto: resolved.numarAuto,
  };
}

/**
 * Vehicles that cannot produce a zone tax yet.
 *
 * Only active ones count. A lorry taken off the road does not need its MTMA chased, and
 * including it would make the alert grow with the fleet's history rather than with the work
 * actually outstanding.
 */
export async function vehiclesMissingMma(db, companyId) {
  const res = await db.query(
    `SELECT id, plate, added_by_ocr FROM vehicles
     WHERE company_id = $1 AND is_active IS NOT FALSE AND mma_kg IS NULL
     ORDER BY added_by_ocr DESC, plate`,
    [companyId],
  );
  return res.rows;
}

/**
 * What the registry knows about a plate written on an aviz.
 *
 * Three answers, not two. "No MTMA" reaches a screen as the same silence whether the lorry is
 * unknown or merely incomplete, and those need different sentences: one is "add the vehicle",
 * the other is "open this vehicle and fill in one field". Collapsing them is how an operator
 * ends up retyping a figure that was already supposed to be recorded once.
 */
export async function vehicleForPlate(db, companyId, numarAuto) {
  const plate = primaryPlate(numarAuto);
  if (!plate) return { plate: null, known: false, mmaKg: null, vehicleId: null };

  const res = await db.query(
    `SELECT id, mma_kg FROM vehicles
     WHERE company_id = $1 AND upper(btrim(plate)) = upper($2)
     ORDER BY mma_kg IS NULL, created_at
     LIMIT 1`,
    [companyId, plate],
  );
  const row = res.rows[0];
  return {
    plate,
    known: Boolean(row),
    vehicleId: row?.id ?? null,
    mmaKg: row?.mma_kg == null ? null : Number(row.mma_kg),
  };
}

/** The MTMA to charge a zone tax on for a plate written on an aviz. */
export async function mmaForPlate(db, companyId, numarAuto) {
  return (await vehicleForPlate(db, companyId, numarAuto)).mmaKg;
}
