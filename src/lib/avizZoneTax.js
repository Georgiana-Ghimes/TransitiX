/**
 * The Bucharest zone fee for one aviz.
 *
 * Three facts meet here and each comes from somewhere different:
 *
 *   the zone    from the delivery address on the aviz, answered by the shipped street index,
 *               so a customer's address is never sent anywhere
 *   the bracket from the lorry's MTMA in Autoturisme, because that is what PMB prices. The
 *               figure on the weighbridge is what the lorry weighed that morning; the
 *               authorisation is bought against the mass on the registration papers, and a
 *               half-empty 19 t lorry still pays the 19 t rate
 *   whether to  from the greutate brută OCR read off the aviz. No weight, no automatic fee:
 *   charge     an aviz whose weight line did not come through is exactly the document nobody
 *               should be billed from without a person looking at it
 *
 * The weight has one more job. A lorry cannot weigh more than its own MTMA, so a brută above
 * the registry figure proves the registry figure is wrong, and that is worth saying out loud
 * before it prices a year of trips into the wrong bracket.
 *
 * Only the delivery address is considered. A lorry that loads at the Militari depot has
 * already driven inside Zone B before it goes anywhere, but the aviz names that end of the
 * journey as a site code ("MIL"), not as a street, and there is nothing here to resolve it
 * with. Charging the delivery end is what can be established from the document.
 */
import { toFiniteNumber } from './utils.js';
import { canonicalPlateClient } from './fleetUi.js';
import { referenceZone } from './zoneReference.js';

/** A lorry cannot weigh this much on a public road; above it the OCR read something else. */
const IMPLAUSIBLE_KG = 60000;

/** Access thresholds from the HCGMB decisions named on the city note, in kg of MTMA. */
const ZONE_ACCESS_THRESHOLD_KG = { ZA: 5000, ZB: 7500 };

/**
 * The tractor's plate.
 *
 * `numar_auto` carries "B-112-VFM / B-475-AGR" on a document with a trailer. The trailer has
 * its own registration and its own mass, and neither is what the authorisation is bought
 * against, so only the first plate is ever looked up. Mirrors `primaryPlate` on the server.
 */
export function tractorPlate(numarAuto) {
  const first = String(numarAuto || '').split(/[/,+]/)[0];
  return canonicalPlateClient(first);
}

/** The tariff row covering an MTMA, or null when the tables do not reach that far. */
export function zoneBracket(zoneCode, mmaKg) {
  const zone = referenceZone(zoneCode);
  const kg = toFiniteNumber(mmaKg);
  if (!zone || kg == null) return null;
  return zone.tariffs.brackets.find(
    (b) => kg >= b.minKg && (b.maxKg == null || kg <= b.maxKg),
  ) ?? null;
}

/** Above this MTMA the zone needs an authorisation at all. */
export function zoneThresholdKg(zoneCode) {
  return ZONE_ACCESS_THRESHOLD_KG[String(zoneCode || '').toUpperCase()] ?? null;
}

function result(status, extra = {}) {
  return {
    status,
    amount: null,
    currency: 'RON',
    zoneCode: null,
    mmaKg: null,
    grossKg: null,
    bracket: null,
    ...extra,
  };
}

/**
 * What to charge, or why nothing can be charged yet.
 *
 * `zoneResult` is what `resolveAddress` from the street index returned for the delivery
 * address, `vehicles` is the Autoturisme list. Everything is passed in so this stays a
 * function of its inputs and the awkward cases can be argued about in a test.
 *
 * Every status the screen has to be able to explain:
 *   no_weight          the aviz has no greutate brută, so nothing is computed
 *   weight_implausible OCR produced a figure no lorry can weigh
 *   no_address         the aviz names no delivery street
 *   outside_city       the delivery is not in a city with zones
 *   address_unknown    the street is not in the index, which is not the same as "no zone"
 *   address_unsure     several streets share the name, or the house number decides and is missing
 *   outside            resolved, and outside every zone: nothing is owed
 *   plate_missing      no plate on the aviz
 *   plate_invalid      the plate field holds something that is not a plate
 *   vehicle_unknown    a plate, but no such lorry in Autoturisme
 *   mma_missing        the lorry is on file with no MTMA, one field away from an answer
 *   mma_suspect        the lorry weighed more than its registered MTMA: the registry is wrong
 *   under_threshold    below the zone's access threshold, so no authorisation and no fee
 *   no_bracket         inside a zone, above the threshold, and off the end of the tariff table
 *   ok                 the amount
 */
export function avizZoneTax({ aviz, vehicles, zoneResult, address }) {
  const grossKg = toFiniteNumber(aviz?.gross_weight_kg);
  if (grossKg == null || grossKg <= 0) return result('no_weight');
  if (grossKg > IMPLAUSIBLE_KG) return result('weight_implausible', { grossKg });

  const base = { grossKg };

  if (address && address.supported === false) return result('outside_city', base);
  if (!address?.street) return result('no_address', base);

  if (!zoneResult) return result('address_unknown', { ...base, query: address.street });
  if (zoneResult.zone && zoneResult.certain === false) {
    return result('address_unsure', { ...base, zoneCode: zoneResult.zone });
  }
  if (!zoneResult.zone) {
    if (zoneResult.certain === false) return result('address_unsure', base);
    return result('outside', { ...base, amount: 0 });
  }

  const zoneCode = zoneResult.zone;
  const withZone = { ...base, zoneCode };

  const plate = tractorPlate(aviz?.numar_auto);
  if (!String(aviz?.numar_auto || '').trim()) return result('plate_missing', withZone);
  if (!plate) return result('plate_invalid', withZone);

  const vehicle = (vehicles ?? []).find(
    (v) => String(v.plate || '').trim().toUpperCase() === plate && v.is_active !== false,
  );
  if (!vehicle) return result('vehicle_unknown', { ...withZone, plate });

  const mmaKg = toFiniteNumber(vehicle.mma_kg);
  if (mmaKg == null) {
    return result('mma_missing', { ...withZone, plate, vehicleId: vehicle.id });
  }

  const withMma = { ...withZone, plate, vehicleId: vehicle.id, mmaKg };
  if (grossKg > mmaKg) return result('mma_suspect', withMma);

  const threshold = zoneThresholdKg(zoneCode);
  const bracket = zoneBracket(zoneCode, mmaKg);
  if (threshold != null && mmaKg <= threshold) {
    // Priced in the table and still not owed: HCGMB 514/2025 lists a 5-7,5 t row for Zone B
    // while access there is restricted only above 7,5 t. The fee is zero and the row is handed
    // back anyway, so the screen can show what the table says instead of silently dropping it.
    return result('under_threshold', { ...withMma, amount: 0, bracket, threshold });
  }
  if (!bracket) return result('no_bracket', withMma);

  return result('ok', { ...withMma, amount: bracket.daily, bracket, threshold });
}

/** Plain Romanian for each outcome, so the screen and its test say the same thing. */
export const ZONE_TAX_MESSAGE = {
  no_weight: 'Fără greutate brută pe aviz, deci taxa de zonă nu se calculează automat.',
  weight_implausible: 'Greutatea brută citită nu poate fi reală, verific-o pe document.',
  no_address: 'Avizul nu are o adresă de livrare din care să citesc zona.',
  outside_city: 'Livrarea nu este într-un oraș cu zone taxate.',
  address_unknown: 'Strada de livrare nu este în indexul orașului, verific-o pe hartă.',
  address_unsure: 'Adresa nu decide singură zona, confirm-o pe Harta zonelor.',
  outside: 'Livrarea este în afara zonelor taxate, nu se adaugă nimic.',
  plate_missing: 'Avizul nu are număr de înmatriculare, deci nu știu ce tonaj se taxează.',
  plate_invalid: 'Numărul auto de pe aviz nu este un număr de înmatriculare valid.',
  vehicle_unknown: 'Mașina nu este în Autoturisme, adaug-o ca să pot lua MTMA.',
  mma_missing: 'Mașina nu are MTMA completat, completează-l în Autoturisme.',
  mma_suspect: 'Greutatea brută depășește MTMA din Autoturisme, deci MTMA este greșit.',
  under_threshold: 'Sub pragul de acces al zonei, nu este nevoie de autorizație.',
  no_bracket: 'MTMA-ul mașinii nu intră în niciun interval din tariful zonei.',
  ok: null,
};

export function zoneTaxMessage(status) {
  return ZONE_TAX_MESSAGE[status] ?? null;
}

/** Whether the operator can act on this outcome by opening Autoturisme. */
export const FLEET_FIXABLE = new Set(['vehicle_unknown', 'mma_missing', 'mma_suspect']);

/** Localities the OCR prints, mapped onto the cities that have an index. */
const CITY_BY_LOCALITY = { bucuresti: 'bucuresti' };

/** Canonical type token for the street index (matches `normalizeStreetName` markers). */
const ROUTE_TYPE_TO_QUERY = {
  str: 'strada', strada: 'strada',
  sosea: 'soseaua', soseaua: 'soseaua', sos: 'soseaua',
  bvd: 'bulevardul', blvd: 'bulevardul', bulevardul: 'bulevardul', bd: 'bulevardul',
  aleea: 'aleea', al: 'aleea',
  piata: 'piata', pta: 'piata',
  calea: 'calea',
};

/**
 * Delivery half of `ruta_transport` — everything after ` / `.
 * Single-leg routes (delivery only) are used as-is.
 */
export function deliveryLegFromRuta(ruta) {
  const s = String(ruta || '').trim();
  if (!s) return null;
  const parts = s.split(/\s\/\s/);
  const leg = (parts.length >= 2 ? parts[parts.length - 1] : parts[0]).trim();
  return leg || null;
}

/**
 * Parse a spaced annex leg: `Bvd. Iuliu Maniu nr. 600A, Bucuresti`
 * → street query + house number + locality for the zone index.
 */
export function parseSpacedRouteLeg(leg) {
  const raw = String(leg || '').trim();
  if (!raw) return null;
  const m = raw.match(
    /^(?:(Str\.?|Șosea|Sosea|Bvd\.?|Blvd\.?|Bd\.?|Aleea|Piața|Piata|Calea)\s+)?(.+?)(?:\s+nr\.?\s*([0-9]+[A-Za-z]?))?\s*,\s*(.+)$/iu,
  );
  if (!m) return null;
  const typeRaw = (m[1] || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş/gi, 's')
    .replace(/ț|ţ/gi, 't')
    .toLowerCase()
    .replace(/\.$/, '');
  const type = ROUTE_TYPE_TO_QUERY[typeRaw] || null;
  const name = String(m[2] || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const number = m[3] ? String(m[3]).toUpperCase() : null;
  const locality = String(m[4] || '').replace(/\s+/g, ' ').trim() || null;
  const street = type ? `${type} ${name}` : name;
  return { street, number, locality, streetName: name, streetType: type };
}

function foldLocality(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș|ş/gi, 's')
    .replace(/ț|ţ/gi, 't')
    .trim();
}

function addressFromParts({ street, number, locality }) {
  const loc = String(locality || '').trim() || null;
  const cityId = CITY_BY_LOCALITY[foldLocality(loc)] ?? null;
  return {
    street: street || null,
    number: number ?? null,
    locality: loc,
    cityId,
    // A locality we have no index for is "no zones here", not "unknown street".
    supported: Boolean(cityId),
  };
}

/**
 * The delivery address, in the shape the street index wants.
 *
 * Prefer the leg after ` / ` in `ruta_transport` (what the operator sees and edits). Fall
 * back to OCR `delivery_address` when the route has no usable delivery half.
 */
export function avizDeliveryAddress(aviz) {
  const fromRoute = parseSpacedRouteLeg(deliveryLegFromRuta(aviz?.ruta_transport));
  if (fromRoute?.street) {
    return addressFromParts(fromRoute);
  }

  const addr = aviz?.delivery_address ?? null;
  const name = String(addr?.streetName || '').trim();
  const type = String(addr?.streetType || '').trim();
  // The type word goes into the query when the document printed one. Bucharest has three
  // Viilor streets that disagree about the zone, so "viilor" alone is a question and
  // "sosea viilor", which is what the aviz actually says, is an answer.
  const typeQuery = ROUTE_TYPE_TO_QUERY[type.toLowerCase().replace(/\.$/, '')] || type || null;
  const street = name ? (typeQuery ? `${typeQuery} ${name}` : name) : null;
  return addressFromParts({
    street,
    number: addr?.houseNumber ?? null,
    locality: addr?.locality,
  });
}

/**
 * The zone of a delivery address, from the shipped index. Nothing leaves the browser.
 *
 * Returns `undefined` for a street the index does not have, which `avizZoneTax` reports as
 * `address_unknown` rather than as "outside the zones". The two look the same on screen and
 * cost very different amounts of money.
 */
export async function resolveAvizZone(address) {
  if (!address?.supported || !address.street) return null;
  const [{ loadStreetIndex, lookupStreet, resolveAddress }, { cityById }] = await Promise.all([
    import('./streetZones/index.js'),
    import('./zoneReference.js'),
  ]);
  const index = await loadStreetIndex(address.cityId);
  if (!index) return null;

  const lookup = lookupStreet(index, address.street);
  if (lookup.status === 'ambiguous') return { zone: null, certain: false, source: 'street' };
  if (lookup.status === 'unknown') return null;

  const cityZones = cityById(address.cityId).zones;
  return resolveAddress(index, { ...lookup, number: address.number }, cityZones);
}
