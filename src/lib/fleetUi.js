/**
 * Reading what somebody typed into the vehicle registry.
 *
 * Kept apart from the screen so the two decisions that matter here can be argued about in a
 * test: what counts as a plate, and what counts as a mass.
 */
import { toFiniteNumber } from './utils.js';

const RO_PLATE_COUNTIES =
  'B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN';

/**
 * A plate typed by hand, in the one form the app stores: `B-112-VFM`.
 *
 * Mirrors `canonicalPlate` on the server, and deliberately returns null rather than the raw
 * text for anything it does not recognise. The server's version hands text back unchanged so a
 * backfill cannot destroy the fleet's non-standard entries; here the caller is a person adding
 * a lorry, and accepting "camionul lui Gigi" as a plate would put a row in the registry that
 * can never match an aviz.
 */
export function canonicalPlateClient(value) {
  const text = String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const match = text.match(new RegExp(`^(${RO_PLATE_COUNTIES})[-\\s]?(\\d{2,3})[-\\s]?([A-Z]{2,3})$`, 'i'));
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}-${match[3].toUpperCase()}`;
}

/**
 * The mass, in kilograms.
 *
 * Tonnes are what people say out loud, so "40" gets typed where 40000 was meant. A figure that
 * small cannot be a lorry's authorised mass — the zone fee itself starts above 5 t — so it is
 * read as tonnes rather than stored as a number that would put every trip in the cheapest
 * bracket. Thousands separators are accepted because the registration prints them.
 */
export function parseMmaKg(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[\s.]/g, '').replace(',', '.');
  const n = toFiniteNumber(cleaned);
  if (n == null || n <= 0) return null;
  if (n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

/** "40.000 kg (40 t)", the way the figure reads on a screen next to a tariff table. */
export function mmaLabel(kg) {
  const n = toFiniteNumber(kg);
  if (n == null) return '—';
  const tonnes = n / 1000;
  return `${n.toLocaleString('ro-RO')} kg (${tonnes.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} t)`;
}

/**
 * What a typed plate says about the mass to charge on.
 *
 * Resolved here, on the client, because the zone map answers from the shipped street index
 * without calling the server at all. Doing this lookup server-side would work on one of the two
 * paths and quietly not on the other, which is worse than not doing it.
 *
 * Five outcomes, and the screen needs every one of them:
 *   none     no plate typed, so nothing to say
 *   invalid  typed, but not a plate
 *   unknown  a plate, but no such lorry on file
 *   missing  the lorry is on file with no MTMA, which is one field away from an answer
 *   found    the figure
 */
export function resolveVehicleMma(vehicles, typedPlate) {
  const plate = canonicalPlateClient(typedPlate);
  if (!String(typedPlate || '').trim()) return { status: 'none', plate: null, mmaKg: null };
  if (!plate) return { status: 'invalid', plate: null, mmaKg: null };

  const match = (vehicles ?? []).find(
    (v) => String(v.plate || '').trim().toUpperCase() === plate && v.is_active !== false,
  );
  if (!match) return { status: 'unknown', plate, mmaKg: null };

  const kg = toFiniteNumber(match.mma_kg);
  if (kg == null) return { status: 'missing', plate, mmaKg: null, vehicleId: match.id };
  return { status: 'found', plate, mmaKg: kg, vehicleId: match.id };
}
