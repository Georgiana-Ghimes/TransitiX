/**
 * The Bucharest zone fee for one aviz.
 *
 * Three facts meet here and each comes from somewhere different:
 *
 *   the zone(s) from the delivery stop(s) only (street index). The Expeditor / loading
 *               address is never used for tax — only Adresa de livrare. Multi-stop: each
 *               unload street is considered; the same zone code is charged once
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
 */
import { toFiniteNumber } from './utils.js';
import { canonicalPlateClient } from './fleetUi.js';
import { referenceZone } from './zoneReference.js';
import { hasStreetTypeWord, splitStreetAndNumber } from './streetName.js';
import { cityIdFromRoPostcode, streetKeyFromPostcode } from './streetZones/postcodeHints.js';

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
  no_loading_street: 'Taxa de zonă nu folosește adresa de încărcare (Expeditor).',
  outside_city: 'Adresa de livrare nu este într-un oraș cu zone taxate.',
  address_unknown: 'Strada nu este în indexul orașului, verific-o pe hartă.',
  address_unsure: 'Adresa nu decide singură zona, confirm-o pe Harta zonelor.',
  outside: 'Adresa este în afara zonelor taxate, nu se adaugă nimic pe acest capăt.',
  plate_missing: 'Avizul nu are număr de înmatriculare, deci nu știu ce tonaj se taxează.',
  plate_invalid: 'Numărul auto de pe aviz nu este un număr de înmatriculare valid.',
  vehicle_unknown: 'Mașina nu este în Autoturisme, adaug-o ca să pot lua MTMA.',
  mma_missing: 'Mașina nu are MTMA completat.',
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
  intrarea: 'intrarea', intrare: 'intrarea', intr: 'intrarea',
};

const ROUTE_TYPE_CAPTURE = String.raw`Str\.?|Șoseaua|Soseaua|Șosea|Sosea|Sos\.?|Bvd\.?|Blvd\.?|Bd\.?|Aleea|Piața|Piata|Calea|Intrarea|Intrare|Intr\.?`;

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
  const raw = peelLeadingCompany(String(leg || '').trim());
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

/** Six-digit Romanian postcode from OCR / route text (`RO 050151` or bare digits). */
export function normalizeRoPostcode(value) {
  const withRo = String(value || '').match(/\bro\s*(\d{5,6})\b/i);
  if (withRo?.[1]) {
    const digits = withRo[1];
    return digits.length === 6 ? digits : digits.padStart(6, '0');
  }
  const m = String(value || '').match(/\b(\d{6})\b/);
  return m?.[1] || null;
}

/**
 * Drop a leading company / site token so `CONCELEX SRL, Șosea Viilor nr. 52, …` still
 * parses as the street. Also peels glued forms from a bad OCR route:
 * `Str. Intermed Srl Intrare Navigatorilor nr. 15` → `Intrare Navigatorilor nr. 15`.
 */
export function peelLeadingCompany(leg) {
  const raw = String(leg || '').trim();
  if (!raw) return raw;

  // Firm then real street type on the same side of the comma (Baumit Client above street).
  const afterFirm = raw.match(
    new RegExp(
      String.raw`\b(?:s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|scs|sra|gmbh|ltd|com)\b\s+((?:${ROUTE_TYPE_CAPTURE})\b[\s\S]+)$`,
      'iu',
    ),
  );
  if (afterFirm?.[1] && hasStreetTypeWord(afterFirm[1])) return afterFirm[1].trim();

  if (!raw.includes(',')) return raw;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;
  const first = parts[0];
  const rest = parts.slice(1).join(', ');
  if (hasStreetTypeWord(first) || !hasStreetTypeWord(rest)) return raw;
  const company = /\b(srl|sa|scs|sra|com|gmbh|ltd)\b/i.test(first);
  const restLooksStreet = new RegExp(
    String.raw`^(?:${ROUTE_TYPE_CAPTURE})\b`,
    'iu',
  ).test(rest);
  if (company || restLooksStreet) return rest;
  return raw;
}

/**
 * House number glued into the street (`Șosea Viilor nr. 52` / `soseaua Viilor 52`).
 * Keeps an explicit number when the caller already split one off.
 */
export function peelHouseNumber(street, number) {
  const explicit = number != null && String(number).trim() !== '' ? String(number).trim() : null;
  if (explicit) return { street: String(street || '').trim() || null, number: explicit };
  const raw = String(street || '').trim();
  if (!raw) return { street: null, number: null };
  const split = splitStreetAndNumber(raw.replace(/\bnr\.?\s+/gi, ' '));
  if (split.number) return { street: split.street || null, number: split.number };
  return { street: raw, number: null };
}

function addressFromParts({ street, number, locality, postcode }) {
  let loc = String(locality || '').trim() || null;
  // Postcode often rides in the locality tail: `București Sector 5, RO 050151`.
  const pcFromLoc = normalizeRoPostcode(loc);
  const pcFromStreet = normalizeRoPostcode(street);
  const pc = normalizeRoPostcode(postcode) || pcFromLoc || pcFromStreet;
  if (loc && pcFromLoc) {
    loc = loc
      .replace(new RegExp(`\\bro\\s*${pc}\\b`, 'i'), '')
      .replace(new RegExp(`\\b${pc}\\b`), '')
      .replace(/[,.\s]+$/g, '')
      .trim() || null;
  }

  const peeled = peelHouseNumber(street, number);
  let cityId = taxedCityIdFromLocality(loc) || cityIdFromRoPostcode(pc);
  // Only București has a shipped zone index. OCR often prints
  // `BOL / Șoseaua Viilor nr. 52` with no city — that is still Bucharest, not "no zones".
  // A named other town (Domnești, …) stays unsupported.
  if (!cityId && (peeled.street || pc) && !loc) cityId = 'bucuresti';
  // Known delivery postcode fills a missing street so Editează still shows a line + fee.
  const streetOut = peeled.street || streetKeyFromPostcode(pc) || null;
  return {
    street: streetOut,
    number: peeled.number,
    locality: cityId === 'bucuresti' ? 'Bucuresti' : loc,
    cityId,
    postcode: pc,
    // A locality we have no index for is "no zones here", not "unknown street".
    supported: Boolean(cityId),
  };
}

/**
 * Free-text query for Harta zonelor: street (+ number) as the index expects it.
 * Outside a zoned city, append the locality so the geocoder does not land on the
 * first same-named street in Romania (often București).
 *
 * Postcode is always appended when known (and also passed as `?postcode=`): the map
 * search box must show it, and Photon tries CP first. `lookupAddress` peels a trailing
 * CP so the București street index still hits.
 */
export function zoneMapSearchQuery(address) {
  if (!address?.street) return null;
  const parts = [address.street, address.number].filter(Boolean);
  if (!parts.length) return null;
  let q = parts.join(' ');
  if (address.locality && !address.supported) {
    q = `${q}, ${address.locality}`;
  }
  const pc = normalizeRoPostcode(address.postcode);
  if (pc && !foldHasPostcode(q, pc)) q = `${q}, ${pc}`;
  return q;
}

function foldHasPostcode(text, pc) {
  return new RegExp(`\\b${pc}\\b`).test(String(text || ''));
}

/**
 * Deep-link to the zone map with the delivery address (and optional plate) prefilled,
 * so Editează can open the pin without retyping.
 *
 * For towns without zone tariffs, `locality` is also passed so the map geocodes against
 * that place instead of appending the open city tab (București).
 * `postcode` is always set when known (mandatory CP search on the map).
 */
export function zoneMapHref(address, { plate = null } = {}) {
  const q = zoneMapSearchQuery(address);
  if (!q) return null;
  const params = new URLSearchParams({ q });
  if (address.cityId) params.set('city', address.cityId);
  if (address.locality && !address.supported) {
    params.set('locality', address.locality);
  }
  const pc = normalizeRoPostcode(address.postcode);
  if (pc) params.set('postcode', pc);
  const plateStr = String(plate || '').trim();
  if (plateStr) params.set('plate', plateStr);
  return `/zone-map?${params.toString()}`;
}

/**
 * Loading / Expeditor address from the origin leg of `ruta_transport`.
 * Kept for route display helpers — zone tax must never call this (#delivery-only).
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
  const ocrPostcode = normalizeRoPostcode(addr?.postcode);

  const fromRoute = parseSpacedRouteLeg(deliveryLegFromRuta(aviz?.ruta_transport));
  if (fromRoute?.street) {
    return addressFromParts({
      ...fromRoute,
      locality: fromRoute.locality || ocrLocality,
      // Route text rarely carries RO ##### — keep the OCR postcode under Adresa de livrare.
      postcode: fromRoute.postcode || ocrPostcode,
    });
  }

  return addressFromParts({
    street: ocrStreet,
    number: addr?.houseNumber ?? null,
    locality: ocrLocality,
    postcode: ocrPostcode,
  });
}

/**
 * Delivery stops only for zone tax — never Expeditor / încărcare.
 * Multi-stop: every unload leg after the first (origin) part of `ruta_transport`.
 * Single-leg route or OCR-only: one livrare from `avizDeliveryAddress`.
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

  // Origin is always first when the route has Expeditor / livrare(s). Never tax it.
  const deliveryTexts = texts.length >= 2 ? texts.slice(1) : texts;
  if (!deliveryTexts.length) {
    const delivery = avizDeliveryAddress(aviz);
    if (!delivery?.street) return [];
    return [{ id: 'livrare', role: 'livrare', label: 'Livrare', address: delivery, raw: null }];
  }

  return deliveryTexts.map((raw, i) => {
    const parsed = parseSpacedRouteLeg(raw);
    const address = parsed?.street
      ? addressFromParts({ ...parsed, locality: parsed.locality })
      : null;
    const label = deliveryTexts.length > 1 ? `Livrare ${i + 1}` : 'Livrare';
    return { id: `livrare_${i + 1}`, role: 'livrare', label, address, raw };
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
 * Live sync for Taxe suplimentare while Editează is open.
 * Writes when the box is empty/zero or still holds the last auto amount; clears that
 * auto amount when the address no longer yields a fee (outside / under threshold / blocked).
 *
 * @returns {{ lastAutoAmount: number|null, patch: { taxe_suplimentare: string, zone_tax_breakdown: string }|null }}
 */
export function zoneTaxAutoFormPatch({
  amount,
  breakdown = '',
  taxeSuplimentare,
  zoneTaxBreakdown,
  lastAutoAmount,
}) {
  const raw = String(taxeSuplimentare ?? '').trim();
  const current = toFiniteNumber(taxeSuplimentare);
  const unset = raw === '' || current === 0;
  const mayWrite = unset || lastAutoAmount == null || current === lastAutoAmount;
  const breakdownStr = breakdown == null ? '' : String(breakdown);

  if (amount != null && Number(amount) > 0) {
    if (!mayWrite) return { lastAutoAmount, patch: null };
    if (current === amount && String(zoneTaxBreakdown ?? '') === breakdownStr) {
      return { lastAutoAmount: amount, patch: null };
    }
    return {
      lastAutoAmount: amount,
      patch: { taxe_suplimentare: String(amount), zone_tax_breakdown: breakdownStr },
    };
  }

  // No billable fee — drop a value we auto-filled so a route edit cannot leave a stale tax.
  if (lastAutoAmount == null) return { lastAutoAmount: null, patch: null };
  if (!mayWrite) return { lastAutoAmount, patch: null };
  if (unset && !String(zoneTaxBreakdown ?? '').trim()) {
    return { lastAutoAmount: null, patch: null };
  }
  return {
    lastAutoAmount: null,
    patch: { taxe_suplimentare: '', zone_tax_breakdown: '' },
  };
}

/**
 * Zone fee for the whole trip: `avizZoneTax` per *delivery* stop, then one charge per
 * distinct zone code, with a total for Taxe suplimentare / raport.
 * Expeditor / `incarcare` legs are dropped — never part of the fee.
 *
 * @param {{
 *   aviz: object,
 *   vehicles: object[],
 *   legs: Array<{ id?: string, role: string, label?: string, address: object|null, zoneResult: object|null|undefined, raw?: string|null }>,
 * }} input
 */
export function avizZoneTaxTrip({ aviz, vehicles, legs }) {
  const list = (Array.isArray(legs) ? legs : []).filter((leg) => leg?.role !== 'incarcare');
  const priced = list.map((leg) => ({
    ...leg,
    result: avizZoneTax({
      aviz,
      vehicles,
      zoneResult: leg.zoneResult,
      address: leg.address || { street: null },
    }),
  }));

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
 * Uses `lookupAddress` (not bare `lookupStreet`) so a glued house number —
 * `Șosea Viilor nr. 52` as the whole street field — still hits the index. When the street
 * text is missing or ambiguous, a known delivery **postcode** (e.g. `050151` → Șos. Viilor)
 * settles the row. Returns `null` only when nothing matched, which `avizZoneTax` reports as
 * `address_unknown` rather than as "outside the zones".
 */
export async function resolveAvizZone(address) {
  if (!address) return null;
  const pc = normalizeRoPostcode(address.postcode);
  const cityId = address.cityId || cityIdFromRoPostcode(pc);
  if (!cityId) return null;

  const peeled = peelHouseNumber(address.street, address.number);
  const hintKey = streetKeyFromPostcode(pc);

  // Postcode-only: OCR lost the street but kept RO ###### under Adresa de livrare.
  if (!peeled.street && !hintKey) return null;

  const [{ loadStreetIndex, lookupStreet, lookupAddress, resolveAddress }, { cityById }] = await Promise.all([
    import('./streetZones/index.js'),
    import('./zoneReference.js'),
  ]);
  const index = await loadStreetIndex(cityId);
  if (!index) return null;

  const cityLabel = cityById(cityId)?.label || 'București';
  const query = [peeled.street, peeled.number].filter(Boolean).join(' ');
  let lookup = peeled.street
    ? lookupAddress(index, query, { cityLabel })
    : { status: 'unknown', found: null, suggestions: [], number: peeled.number };

  // Known delivery postcode wins over an unknown / ambiguous OCR street.
  if (hintKey && (lookup.status === 'unknown' || lookup.status === 'ambiguous')) {
    const byPc = lookupStreet(index, hintKey);
    if (byPc.status === 'exact' || byPc.status === 'without-type') {
      lookup = { ...byPc, number: lookup.number || peeled.number, source: 'postcode' };
    }
  }

  if (lookup.status === 'ambiguous') return { zone: null, certain: false, source: 'street' };
  if (lookup.status === 'unknown' || !lookup.found) return null;

  const cityZones = cityById(cityId).zones;
  const number = lookup.number || peeled.number;
  return resolveAddress(index, { ...lookup, number }, cityZones);
}
