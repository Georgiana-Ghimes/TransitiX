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
