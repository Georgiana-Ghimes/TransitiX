/**
 * The Bucharest zone fee for one aviz.
 *
 * Three facts meet here and each comes from somewhere different:
 *
 *   the zone(s) from the loading and delivery legs of the route (street index), so a
 *               customer's address is never sent anywhere. Access is owed per zone entered
 *               (#97): load in A + unload in B → both fees; same zone at both ends → once
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
 * A loading leg that is only a site code (BOL / MIL-NEAMTIU) cannot be zoned — that end is
 * reported as unresolved, and only street-backed ends are charged.
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
  no_address: 'Avizul nu are o adresă (încărcare sau livrare) din care să citesc zona.',
  no_loading_street: 'Încărcarea e doar cod de depozit (BOL/MIL), fără stradă — nu pot taxa zona de încărcare.',
  outside_city: 'Adresa nu este într-un oraș cu zone taxate.',
  address_unknown: 'Strada nu este în indexul orașului, verific-o pe hartă.',
  address_unsure: 'Adresa nu decide singură zona, confirm-o pe Harta zonelor.',
  outside: 'Adresa este în afara zonelor taxate, nu se adaugă nimic pe acest capăt.',
  plate_missing: 'Avizul nu are număr de înmatriculare, deci nu știu ce tonaj se taxează.',
  plate_invalid: 'Numărul auto de pe aviz nu este un număr de înmatriculare valid.',
  vehicle_unknown: 'Mașina nu este în Autoturisme, adaug-o ca să pot lua MTMA.',
  mma_missing: 'Mașina nu are MTMA completat, completează-l în Autoturisme.',
  mma_suspect: 'Greutatea brută depășește MTMA din Autoturisme, deci MTMA este greșit.',
  under_threshold: 'Sub pragul de acces al zonei, nu este nevoie de autorizație.',
  no_bracket: 'MTMA-ul mașinii nu intră în niciun interval din tariful zonei.',
  ok: null,
};

/** Shared fleet / weight failures — apply once to the whole trip, not per leg. */
const TRIP_BLOCKING = new Set([
  'no_weight', 'weight_implausible', 'plate_missing', 'plate_invalid',
  'vehicle_unknown', 'mma_missing', 'mma_suspect',
]);

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

const ROUTE_TYPE_CAPTURE = String.raw`Str\.?|Șoseaua|Soseaua|Șosea|Sosea|Sos\.?|Bvd\.?|Blvd\.?|Bd\.?|Aleea|Piața|Piata|Calea`;

/**
 * Origin / destination separators drivers and the office actually type (#71).
 * Spaced `-` only — never `Bolintin-Deal`. Arrows and ` / ` are unambiguous.
 */
const ROUTE_LEG_SPLIT = /\s*(?:→|->|–|—)\s*|\s+\/\s+|\s+-\s+/;

/** Every origin / stop text from `ruta_transport`, document order (#98). */
export function routeLegTexts(ruta) {
  const s = String(ruta || '').trim();
  if (!s) return [];
  return s.split(ROUTE_LEG_SPLIT).map((p) => p.trim()).filter(Boolean);
}

/**
 * Loading half of `ruta_transport` (first leg when the route has origin / destination).
 * Site codes alone (`MIL-NEAMTIU`) are returned as text — `avizLoadingAddress` drops them
 * when they are not a street the index can resolve (#97).
 */
export function originLegFromRuta(ruta) {
  const parts = routeLegTexts(ruta);
  if (parts.length < 2) return null;
  return parts[0] || null;
}

/**
 * Delivery half of `ruta_transport` for zone tax.
 * Multi-stop (#61): prefer a București leg among destinations; else the last stop.
 * Single-leg routes (delivery only) are used as-is.
 * Separators `→` / `->` / ` - ` / ` / ` must all yield the same delivery leg (#71).
 * For full multi-stop charging use `avizRouteZoneLegs` (#98).
 */
export function deliveryLegFromRuta(ruta) {
  const parts = routeLegTexts(ruta);
  if (!parts.length) return null;
  const delivery = parts.length >= 2 ? parts.slice(1) : parts;
  const bucharest = delivery.find((leg) => {
    const loc = foldLocality(leg);
    return /\bbucuresti\b/.test(loc) || /,?\s*sector(?:ul)?\s*[1-6]\b/.test(loc);
  });
  if (bucharest) return bucharest;
  return delivery[delivery.length - 1] || null;
}

/**
 * Parse a spaced annex leg: `Bvd. Iuliu Maniu nr. 600A, Bucuresti`
 * → street query + house number + locality for the zone index.
 */
export function parseSpacedRouteLeg(leg) {
  const raw = String(leg || '').trim();
  if (!raw) return null;
  // Comma first: `Șosea Viilor nr. 52, sector 5, București`. A space-and-rest pattern
  // would steal `nr. 52` as the "locality" when the city is missing.
  const comma = raw.match(
    new RegExp(
      String.raw`^(?:(${ROUTE_TYPE_CAPTURE})\s+)?(.+?)(?:\s+nr\.?\s*([0-9]+[A-Za-z]?))?\s*,\s*(.+)$`,
      'iu',
    ),
  );
  const numbered = raw.match(
    new RegExp(
      String.raw`^(?:(${ROUTE_TYPE_CAPTURE})\s+)?(.+?)\s+nr\.?\s*([0-9]+[A-Za-z]?)(?:\s+(.+))?$`,
      'iu',
    ),
  );
  const m = comma || numbered;
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
  let locality = m[4] ? String(m[4]).replace(/\s+/g, ' ').trim() : null;
  if (locality && !comma && !taxedCityIdFromLocality(locality)) locality = null;
  const number = m[3] ? String(m[3]).toUpperCase() : null;
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

/**
 * `sector 5, București` / bare `sector 5` / `Bucuresti Sector 5` still means the city
 * with an index. Exact-only matching used to call those "no zones here".
 */
export function taxedCityIdFromLocality(value) {
  const folded = foldLocality(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!folded) return null;
  if (CITY_BY_LOCALITY[folded]) return CITY_BY_LOCALITY[folded];
  if (/\bbucuresti\b/.test(folded)) return 'bucuresti';
  // Bucharest districts alone (OCR often drops the city after the street).
  if (/^sector(?:ul)?\s*[1-6]\b/.test(folded)) return 'bucuresti';
  return null;
}

function addressFromParts({ street, number, locality }) {
  const loc = String(locality || '').trim() || null;
  let cityId = taxedCityIdFromLocality(loc);
  // Only București has a shipped zone index. OCR often prints
  // `BOL / Șoseaua Viilor nr. 52` with no city — that is still Bucharest, not "no zones".
  // A named other town (Domnești, …) stays unsupported.
  if (!cityId && street && !loc) cityId = 'bucuresti';
  return {
    street: street || null,
    number: number ?? null,
    locality: cityId === 'bucuresti' ? 'Bucuresti' : loc,
    cityId,
    // A locality we have no index for is "no zones here", not "unknown street".
    supported: Boolean(cityId),
  };
}

/**
 * Free-text query for Harta zonelor: street (+ number) as the index expects it.
 * Outside a zoned city, append the locality so the geocoder does not land on the
 * first same-named street in Romania (often București).
 * Example: `bulevardul Iuliu Maniu 600A` / `strada Republicii 1F, Bolintin-Deal`.
 */
export function zoneMapSearchQuery(address) {
  if (!address?.street) return null;
  const parts = [address.street, address.number].filter(Boolean);
  if (!parts.length) return null;
  let q = parts.join(' ');
  if (address.locality && !address.supported) {
    q = `${q}, ${address.locality}`;
  }
  return q;
}

/**
 * Deep-link to the zone map with the delivery address (and optional plate) prefilled,
 * so Editează can open the pin without retyping.
 *
 * For towns without zone tariffs, `locality` is also passed so the map geocodes against
 * that place instead of appending the open city tab (București).
 */
export function zoneMapHref(address, { plate = null } = {}) {
  const q = zoneMapSearchQuery(address);
  if (!q) return null;
  const params = new URLSearchParams({ q });
  if (address.cityId) params.set('city', address.cityId);
  if (address.locality && !address.supported) {
    params.set('locality', address.locality);
  }
  const plateStr = String(plate || '').trim();
  if (plateStr) params.set('plate', plateStr);
  return `/zone-map?${params.toString()}`;
}

/**
 * Loading address from the origin leg of `ruta_transport`, when it is a real street.
 * Site/depot codes alone cannot be zoned — returns null so the panel can say so (#97).
 */
export function avizLoadingAddress(aviz) {
  const fromRoute = parseSpacedRouteLeg(originLegFromRuta(aviz?.ruta_transport));
  if (!fromRoute?.street) return null;
  return addressFromParts({
    ...fromRoute,
    locality: fromRoute.locality,
  });
}

/**
 * The delivery address, in the shape the street index wants.
 *
 * Prefer the delivery leg of `ruta_transport` (after ` / `, `→`, `->`, or spaced `-`).
 * Fall back to OCR `delivery_address` when the route has no usable delivery half.
 */
export function avizDeliveryAddress(aviz) {
  const addr = aviz?.delivery_address ?? null;
  const name = String(addr?.streetName || '').trim();
  const type = String(addr?.streetType || '').trim();
  // The type word goes into the query when the document printed one. Bucharest has three
  // Viilor streets that disagree about the zone, so "viilor" alone is a question and
  // "sosea viilor", which is what the aviz actually says, is an answer.
  const typeQuery = ROUTE_TYPE_TO_QUERY[type.toLowerCase().replace(/\.$/, '')] || type || null;
  const ocrStreet = name ? (typeQuery ? `${typeQuery} ${name}` : name) : null;
  const ocrLocality = addr?.locality ?? null;

  const fromRoute = parseSpacedRouteLeg(deliveryLegFromRuta(aviz?.ruta_transport));
  if (fromRoute?.street) {
    return addressFromParts({
      ...fromRoute,
      locality: fromRoute.locality || ocrLocality,
    });
  }

  return addressFromParts({
    street: ocrStreet,
    number: addr?.houseNumber ?? null,
    locality: ocrLocality,
  });
}

/**
 * Every stop on the route that can be shown / zoned (#97 / #98).
 * First leg = încărcare; each later street leg = a livrare (multi-stop keeps all of them).
 * City indexes beyond București plug in via `taxedCityIdFromLocality` / street indexes.
 *
 * @returns {Array<{ id: string, role: string, label: string, address: object|null, raw: string|null }>}
 */
export function avizRouteZoneLegs(aviz) {
  const texts = routeLegTexts(aviz?.ruta_transport);
  if (!texts.length) {
    const delivery = avizDeliveryAddress(aviz);
    if (!delivery?.street) return [];
    return [{ id: 'livrare', role: 'livrare', label: 'Livrare', address: delivery, raw: null }];
  }

  const deliveryCount = Math.max(0, texts.length - 1);
  return texts.map((raw, i) => {
    const parsed = parseSpacedRouteLeg(raw);
    const address = parsed?.street
      ? addressFromParts({ ...parsed, locality: parsed.locality })
      : null;
    if (i === 0) {
      return { id: 'incarcare', role: 'incarcare', label: 'Încărcare', address, raw };
    }
    const label = deliveryCount > 1 ? `Livrare ${i}` : 'Livrare';
    return { id: `livrare_${i}`, role: 'livrare', label, address, raw };
  });
}

/**
 * Compact text for reports / extracted_data: `ZA 2.133 lei; ZB 363 lei` (#98).
 */
export function formatZoneTaxBreakdown(trip) {
  const lines = Array.isArray(trip?.chargeLines) ? trip.chargeLines : [];
  if (!lines.length) return '';
  return lines
    .map((line) => `${line.zoneCode} ${Number(line.amount).toLocaleString('ro-RO')} lei`)
    .join('; ');
}

/**
 * Zone fee for the whole trip: `avizZoneTax` per stop, then one charge per distinct
 * zone code, with a total for Taxe suplimentare / raport (#97 / #98).
 *
 * @param {{
 *   aviz: object,
 *   vehicles: object[],
 *   legs: Array<{ id?: string, role: string, label?: string, address: object|null, zoneResult: object|null|undefined, raw?: string|null }>,
 * }} input
 */
export function avizZoneTaxTrip({ aviz, vehicles, legs }) {
  const list = Array.isArray(legs) ? legs : [];
  const priced = list.map((leg) => {
    if (leg.role === 'incarcare' && !leg.address?.street && (leg.raw || originLegFromRuta(aviz?.ruta_transport))) {
      return {
        ...leg,
        result: result('no_loading_street', { grossKg: toFiniteNumber(aviz?.gross_weight_kg) }),
      };
    }
    return {
      ...leg,
      result: avizZoneTax({
        aviz,
        vehicles,
        zoneResult: leg.zoneResult,
        address: leg.address || { street: null },
      }),
    };
  });

  const blocking = priced.find((leg) => TRIP_BLOCKING.has(leg.result.status));
  if (blocking) {
    return {
      ...blocking.result,
      amount: null,
      total: null,
      legs: priced,
      zones: [],
      chargeLines: [],
    };
  }

  /** One charge per zone code (two stops in ZA → once; ZA + ZB → both). */
  const chargedByZone = new Map();
  for (const leg of priced) {
    const r = leg.result;
    if (r.status !== 'ok' || !(Number(r.amount) > 0) || !r.zoneCode) continue;
    if (!chargedByZone.has(r.zoneCode)) chargedByZone.set(r.zoneCode, leg);
  }

  const zones = [...chargedByZone.keys()];
  const chargeLines = zones.map((code) => {
    const leg = chargedByZone.get(code);
    return {
      zoneCode: code,
      amount: Number(leg.result.amount),
      label: leg.label || leg.role,
      address: leg.address || null,
      legId: leg.id || leg.role,
    };
  });
  const amount = chargeLines.reduce((sum, line) => sum + line.amount, 0);
  const firstOk = chargedByZone.size
    ? chargedByZone.get(zones[0]).result
    : null;

  if (firstOk) {
    return {
      ...firstOk,
      status: 'ok',
      amount,
      total: amount,
      zoneCode: zones.length === 1 ? zones[0] : zones.join('+'),
      legs: priced,
      zones,
      chargeLines,
    };
  }

  // Nothing to charge: prefer a delivery leg's outcome for the banner tone/message.
  const delivery = [...priced].reverse().find((l) => l.role === 'livrare') || priced[priced.length - 1];
  const fallback = delivery?.result || result('no_address');
  return {
    ...fallback,
    amount: fallback.status === 'outside' || fallback.status === 'under_threshold' ? 0 : null,
    total: fallback.status === 'outside' || fallback.status === 'under_threshold' ? 0 : null,
    legs: priced,
    zones: [],
    chargeLines: [],
  };
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
