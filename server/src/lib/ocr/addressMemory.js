/**
 * Company-local memory of addresses its avize have shown us (#112).
 *
 * A scanner's text layer can mangle the Expeditor street (`Str.-.epuolicii, nr. IF`) while
 * the town and postcode survive (`Bolintin-Deal RO 087015`). The depot is the same on
 * hundreds of avize and on most of them the street reads cleanly, so the clean reads fill the
 * bad ones: look the postcode up among addresses this company has already seen.
 *
 * Nothing is typed in by a developer and nothing is guessed across companies. An address
 * becomes usable only once it is trusted (see `isTrustedAddress`), and a route that used one
 * is flagged for review, because the street on it did not come from this page.
 *
 * Order on every path: structural parse → this memory (only when the street is unreadable)
 * → routeLearn (whole-route rules from office corrections), which still has the last word.
 */

import {
  buildRouteWithOrigin,
  expeditorOrigin,
  formatAddressLine,
  parseDeliveryAddresses,
} from '../avizOcr.js';

export const ADDRESS_ROLE_ORIGIN = 'origin';
/**
 * Adresa de livrare. Same idea as the depot: the customer's site comes back on many avize, and
 * a clean read of it fills a page where only the town and postcode survived. Bucharest postcodes
 * name a street block, so the postcode alone already narrows it to one or two addresses.
 */
export const ADDRESS_ROLE_DELIVERY = 'delivery';

/** Rows from before roles existed are origins. */
function hasRole(address, role) {
  return (address?.role || ADDRESS_ROLE_ORIGIN) === role;
}

/**
 * Memory reads the Baumit Expeditor / Adresa de livrare layout. CMR and carnet routes are built
 * differently and must not be rebuilt from it. A row with no profile (predates profiles) is a
 * Baumit aviz in practice and goes through the same structural parse on read.
 */
export function isAddressMemoryProfile(profileId) {
  if (profileId == null || profileId === '') return true;
  return /^aviz_baumit/.test(String(profileId));
}

/** Two clean reads on different avize before a parsed address may fill another one. */
export const TRUST_SEEN_COUNT = 2;

/** Among several addresses on one postcode, the garbled street must look at least this alike. */
export const MIN_STREET_SIMILARITY = 0.6;
/** …and beat the runner-up by this much, or we do not pick. */
const MIN_SIMILARITY_MARGIN = 0.15;

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ș|ş|Ș|Ş/g, 's')
    .replace(/ț|ţ|Ț|Ţ/g, 't')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dedupe key for one leg: folded, punctuation-insensitive. */
export function addressMatchKey(display) {
  return fold(display).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Six digits, or null. `87015` (leading zero dropped by OCR) is padded like the parser does. */
export function normalizePostcode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 6) return digits;
  if (digits.length === 5) return digits.padStart(6, '0');
  return null;
}

/**
 * Usable to fill a document: confirmed by a platform operator, entered or corrected by a
 * person, or read cleanly on at least TRUST_SEEN_COUNT different avize. Disabled never.
 */
export function isTrustedAddress(address) {
  if (!address || address.disabled) return false;
  if (address.verified) return true;
  if (address.source === 'corrected' || address.source === 'manual') return true;
  return Number(address.seen_count || 0) >= TRUST_SEEN_COUNT;
}

/** Human status for lists: trusted / candidate / disabled. */
export function addressTrustState(address) {
  if (address?.disabled) return 'disabled';
  return isTrustedAddress(address) ? 'trusted' : 'candidate';
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** 1 = identical, 0 = nothing alike. */
export function similarity(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const HINT_NOISE = new Set([
  'expeditor', 'site', 'depozit', 'depozite', 'pagina', 'romania', 'strada', 'sosea',
  'soseaua', 'bulevardul', 'calea', 'aleea', 'numar', 'adresa', 'livrare', 'aviz',
]);

/**
 * Word-ish leftovers of the street in the Expeditor block (`epuolicii` from `Str.-.epuolicii`).
 * Town words are dropped, they would match every address on the postcode.
 */
export function expeditorStreetHints(rawText, locality) {
  const folded = fold(rawText);
  const start = folded.indexOf('expeditor');
  if (start < 0) return [];
  const rest = folded.slice(start + 'expeditor'.length);
  const end = rest.search(/adres[aăe]\s+de\s+livrare|adrese\s+de\s+livrare|aviz\s+de\s+expeditie/);
  const section = (end >= 0 ? rest.slice(0, end) : rest.slice(0, 300));
  const townWords = new Set(fold(locality).split(/[\s-]+/).filter(Boolean));
  return [...new Set(section.split(/[^a-z]+/).filter((w) => (
    w.length >= 4 && !HINT_NOISE.has(w) && !townWords.has(w)
  )))];
}

/** Best likeness of any hint word to the address's street name (longest word of it). */
export function streetHintScore(address, hints) {
  const words = fold(address?.street_name || '').split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length || !hints?.length) return 0;
  let best = 0;
  for (const w of words) {
    for (const h of hints) best = Math.max(best, similarity(w, h));
  }
  return best;
}

/**
 * Pick the stored address for this postcode (+ town when both are known).
 *
 *   one trusted candidate        → it (the postcode + town already say which depot)
 *   several                      → the one the garbled street resembles, clearly; else none
 *
 * Human-confirmed addresses (verified / corrected / manual) are preferred over parsed ones.
 */
export function pickKnownAddress(addresses, { postcode, locality, hints = [] } = {}) {
  const pc = normalizePostcode(postcode);
  if (!pc) return null;
  const town = fold(locality);
  let pool = (addresses || []).filter((a) => (
    a && normalizePostcode(a.postcode) === pc
    && isTrustedAddress(a)
    && (!town || !a.locality || fold(a.locality) === town)
  ));
  if (!pool.length) return null;
  const human = pool.filter((a) => a.verified || a.source === 'corrected' || a.source === 'manual');
  if (human.length) pool = human;
  if (pool.length === 1) return pool[0];

  const scored = pool
    .map((a) => ({ a, score: streetHintScore(a, hints) }))
    .sort((x, y) => y.score - x.score);
  const [first, second] = scored;
  if (first.score < MIN_STREET_SIMILARITY) return null;
  if (second && first.score - second.score < MIN_SIMILARITY_MARGIN) return null;
  return first.a;
}

/**
 * Route with the origin filled from memory, when — and only when — the Expeditor street is
 * unreadable on this page. A Site-Depozit pair (`MIL-NEAMTIU`) is a printed origin of its own
 * and is left alone.
 *
 * @returns {{ route: string, address: object } | null}
 */
export function fillOriginFromMemory(rawText, addresses) {
  const address = pickOriginFromMemory(rawText, addresses);
  if (!address) return null;
  const route = buildRouteWithOrigin(rawText, address.display, { originNeedsDelivery: true });
  if (!route || !route.includes(' / ')) return null;
  return { route, address };
}

/** The learned depot for this page when its Expeditor street is unreadable, else null. */
function pickOriginFromMemory(rawText, addresses) {
  const origins = (addresses || []).filter((a) => hasRole(a, ADDRESS_ROLE_ORIGIN));
  if (!rawText || !origins.length) return null;
  const origin = expeditorOrigin(rawText);
  if (origin.status === 'street') return null;
  if (origin.status === 'site' && /-/.test(origin.leg || '')) return null;
  const postcode = origin.block?.postcode;
  if (!normalizePostcode(postcode)) return null;
  const locality = origin.block?.locality || null;
  return pickKnownAddress(origins, {
    postcode,
    locality,
    hints: expeditorStreetHints(rawText, locality),
  });
}

const DELIVERY_HINT_NOISE = new Set([
  ...HINT_NOISE, 'client', 'factura', 'sucursala', 'bucuresti', 'sector', 'construct', 'build',
]);

/** Word-ish leftovers of the street under Adresa de livrare (same idea as the Expeditor hints). */
export function deliveryStreetHints(rawText, locality) {
  const folded = fold(rawText);
  const start = folded.search(/adres[aăe]\s+de\s+livrare/);
  if (start < 0) return [];
  const rest = folded.slice(start).replace(/^adres[aăe]\s+de\s+livrare/, '');
  const end = rest.search(/client\s+factura|transportator|comanda\s+de\s+transport|referinta/);
  const section = end >= 0 ? rest.slice(0, end) : rest.slice(0, 300);
  const townWords = new Set(fold(locality).split(/[\s-]+/).filter(Boolean));
  return [...new Set(section.split(/[^a-z]+/).filter((w) => (
    w.length >= 4 && !DELIVERY_HINT_NOISE.has(w) && !townWords.has(w)
  )))];
}

/**
 * Delivery stops with the unreadable ones filled from this company's learned delivery
 * addresses. A stop whose street was read stays as read; only a stop that kept its postcode
 * but lost its street is looked up.
 *
 * @returns {{ legs: string[], addresses: object[] } | null}  null when nothing was filled
 */
export function fillDeliveryFromMemory(rawText, addresses) {
  const known = (addresses || []).filter((a) => hasRole(a, ADDRESS_ROLE_DELIVERY));
  if (!rawText || !known.length) return null;
  const blocks = parseDeliveryAddresses(rawText);
  if (!blocks.length) return null;
  const used = [];
  const legs = blocks.map((block) => {
    if (block.streetName) return formatAddressLine(block);
    const postcode = normalizePostcode(block.postcode);
    if (!postcode) return formatAddressLine(block);
    const address = pickKnownAddress(known, {
      postcode,
      locality: block.locality,
      hints: deliveryStreetHints(rawText, block.locality),
    });
    if (!address) return formatAddressLine(block);
    used.push(address);
    return address.display;
  });
  if (!used.length) return null;
  return { legs: legs.filter(Boolean), addresses: used };
}

/**
 * Apply memory onto a values object (extract) or a row (list/export): the Expeditor and every
 * delivery stop whose street the page lost. Never touches a route the office pinned
 * (`corrected_fields`).
 *
 * @returns {{ values: object, address: object|null, deliveryAddresses: object[] }}
 *   `address` is the origin used, `deliveryAddresses` the delivery ones.
 */
export function applyAddressMemory(values, rawText, addresses, { correctedFields = [] } = {}) {
  const out = { ...(values || {}) };
  const none = { values: out, address: null, deliveryAddresses: [] };
  if (correctedFields.includes('ruta_transport')) return none;

  const originAddress = pickOriginFromMemory(rawText, addresses);
  const delivery = fillDeliveryFromMemory(rawText, addresses);
  if (!originAddress && !delivery) return none;

  let route;
  if (originAddress) {
    route = buildRouteWithOrigin(rawText, originAddress.display, {
      originNeedsDelivery: true,
      destLegs: delivery?.legs || null,
    });
  } else {
    const { leg, status } = expeditorOrigin(rawText);
    route = buildRouteWithOrigin(rawText, leg, {
      originNeedsDelivery: status === 'locality',
      destLegs: delivery.legs,
    });
  }
  if (!route || !route.includes(' / ')) return none;
  out.ruta_transport = route;
  return { values: out, address: originAddress, deliveryAddresses: delivery?.addresses || [] };
}

/** Origin-only view of {@link applyAddressMemory}, kept for callers that predate delivery memory. */
export function applyOriginMemory(values, rawText, addresses, opts = {}) {
  const origins = (addresses || []).filter((a) => hasRole(a, ADDRESS_ROLE_ORIGIN));
  const { values: out, address } = applyAddressMemory(values, rawText, origins, opts);
  return { values: out, address };
}

/**
 * A clean Expeditor read worth remembering: street, town and a six-digit postcode.
 * @returns {null | { postcode, locality, street_name, display, match_key }}
 */
export function originObservationFromOcr(rawText) {
  if (!rawText) return null;
  const origin = expeditorOrigin(rawText);
  if (origin.status !== 'street') return null;
  const postcode = normalizePostcode(origin.block?.postcode);
  const locality = origin.block?.locality || null;
  if (!postcode || !locality || !origin.leg) return null;
  return {
    postcode,
    locality,
    street_name: origin.block.streetName || null,
    display: origin.leg,
    match_key: addressMatchKey(origin.leg),
  };
}

/**
 * Clean Adresa de livrare reads worth remembering: every stop with a street, a town and a
 * six-digit postcode. One per (postcode, address), so a stop printed twice counts once.
 * @returns {{ postcode, locality, street_name, display, match_key }[]}
 */
export function deliveryObservationsFromOcr(rawText) {
  if (!rawText) return [];
  const seen = new Set();
  const out = [];
  for (const block of parseDeliveryAddresses(rawText)) {
    const postcode = normalizePostcode(block?.postcode);
    const locality = block?.locality || null;
    if (!block?.streetName || !postcode || !locality) continue;
    const display = formatAddressLine(block);
    if (!display) continue;
    const matchKey = addressMatchKey(display);
    if (seen.has(`${postcode}|${matchKey}`)) continue;
    seen.add(`${postcode}|${matchKey}`);
    out.push({ postcode, locality, street_name: block.streetName, display, match_key: matchKey });
  }
  return out;
}

const STREET_LEG_RE = /\b(?:str|strada|sos|sosea|soseaua|bvd|blvd|bd|bulevardul|b-dul|calea|aleea|al|intrarea|piata|nr)\b\.?/i;

/** `Str. Republicii nr. 1F, Bolintin-Deal` → { street_name: 'republicii', locality: 'Bolintin-Deal' } */
export function splitAddressLeg(leg) {
  const text = String(leg || '').trim();
  const comma = text.lastIndexOf(',');
  const locality = comma >= 0 ? text.slice(comma + 1).trim() || null : null;
  const streetPart = comma >= 0 ? text.slice(0, comma) : text;
  const street_name = fold(streetPart)
    .replace(/\bnr\.?\s*\S+.*$/, '')
    .replace(new RegExp(`^${STREET_LEG_RE.source}\\s*`, 'i'), '')
    .replace(/[.,]+$/g, '')
    .trim() || null;
  return { street_name, locality };
}

/** True when a leg reads like a street address (type or house number), not a code or a town. */
export function looksLikeStreetLeg(leg) {
  return STREET_LEG_RE.test(fold(leg));
}

/**
 * The origin leg of a route the office typed, tied to the postcode on the page.
 * Only a street leg is remembered (not `MIL-NEAMTIU`, not a lone town), and only when its
 * town agrees with the town printed under Expeditor.
 */
export function originObservationFromCorrection(rawText, correctedRoute) {
  const legs = String(correctedRoute || '').split(/\s+\/\s+/).map((l) => l.trim()).filter(Boolean);
  if (legs.length < 2) return null;
  const leg = legs[0];
  if (!looksLikeStreetLeg(leg)) return null;
  const { street_name: streetName, locality: legTown } = splitAddressLeg(leg);
  const origin = expeditorOrigin(rawText || '');
  const postcode = normalizePostcode(origin.block?.postcode);
  if (!postcode) return null;
  const pageTown = origin.block?.locality || null;
  if (legTown && pageTown && fold(legTown) !== fold(pageTown)) return null;
  return {
    postcode,
    locality: legTown || pageTown,
    street_name: streetName,
    display: leg,
    match_key: addressMatchKey(leg),
  };
}

/**
 * The delivery legs of a route the office typed, each tied to a postcode printed under Adresa
 * de livrare. Legs pair with the page's stops in order when the counts agree (one stop, or the
 * same number of stops); otherwise we cannot tell which postcode a leg belongs to and learn
 * nothing. A leg whose town disagrees with its stop's town is skipped.
 */
export function deliveryObservationsFromCorrection(rawText, correctedRoute) {
  const legs = String(correctedRoute || '').split(/\s+\/\s+/).map((l) => l.trim()).filter(Boolean);
  const destLegs = legs.slice(1);
  if (!destLegs.length) return [];
  const stops = parseDeliveryAddresses(rawText || '');
  if (!stops.length || stops.length !== destLegs.length) return [];
  const out = [];
  destLegs.forEach((leg, i) => {
    if (!looksLikeStreetLeg(leg)) return;
    const postcode = normalizePostcode(stops[i]?.postcode);
    if (!postcode) return;
    const { street_name: streetName, locality: legTown } = splitAddressLeg(leg);
    const pageTown = stops[i]?.locality || null;
    if (legTown && pageTown && fold(legTown) !== fold(pageTown)) return;
    out.push({
      postcode,
      locality: legTown || pageTown,
      street_name: streetName,
      display: leg,
      match_key: addressMatchKey(leg),
    });
  });
  return out;
}

// ── persistence ─────────────────────────────────────────────────────────────────────────

const COLUMNS = `id, company_id, role, postcode, locality, street_name, display, match_key, source,
  seen_count, used_count, verified, disabled, merged_into, source_document_id, updated_by,
  last_seen_at, last_used_at, created_at, updated_at`;

/** Longest alias chain followed; a merge re-points aliases, so real chains are length 1. */
const MAX_MERGE_HOPS = 5;

export async function listKnownAddresses(queryFn, companyId, { role = ADDRESS_ROLE_ORIGIN } = {}) {
  if (!companyId) return [];
  // `role: null` → every role (extract fills origin and delivery from one list).
  const { rows } = await queryFn(
    `SELECT ${COLUMNS} FROM aviz_known_addresses
     WHERE company_id = $1 AND ($2::text IS NULL OR role = $2) AND disabled = FALSE AND merged_into IS NULL
     ORDER BY postcode, seen_count DESC`,
    [companyId, role],
  );
  return rows;
}

/**
 * Upsert the address and count this document once.
 * A human source upgrades a parsed row; it never downgrades a corrected/manual one.
 * @param {'parsed'|'corrected'|'manual'} source
 */
export async function recordAddressSighting(queryFn, {
  companyId, documentId = null, observation, source = 'parsed', role = ADDRESS_ROLE_ORIGIN, userId = null,
} = {}) {
  if (!companyId || !observation?.postcode || !observation?.display) return null;
  const { rows } = await queryFn(
    `INSERT INTO aviz_known_addresses (
       company_id, role, postcode, locality, street_name, display, match_key, source,
       source_document_id, updated_by, last_seen_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (company_id, role, postcode, match_key) DO UPDATE SET
       source = CASE WHEN aviz_known_addresses.source = 'parsed' THEN EXCLUDED.source
                     ELSE aviz_known_addresses.source END,
       updated_by = COALESCE(EXCLUDED.updated_by, aviz_known_addresses.updated_by),
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING ${COLUMNS}`,
    [
      companyId, role, observation.postcode, observation.locality || null,
      observation.street_name || null, observation.display, observation.match_key,
      source, documentId, userId,
    ],
  );
  let row = rows[0];
  if (!row) return null;
  // A known misread: the sighting belongs to the address it was merged into.
  if (row.merged_into) {
    const target = await resolveMergeTarget(queryFn, row);
    if (target) {
      row = target;
      await queryFn(
        `UPDATE aviz_known_addresses SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.id],
      );
    }
  }
  if (!documentId) return row;
  const seen = await queryFn(
    `INSERT INTO aviz_known_address_sightings (address_id, document_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING address_id`,
    [row.id, documentId],
  );
  if (!seen.rowCount) return row;
  const bumped = await queryFn(
    `UPDATE aviz_known_addresses SET seen_count = seen_count + 1
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [row.id],
  );
  return bumped.rows[0] || row;
}

/** The live address a merged alias points to (follows re-pointed chains defensively). */
async function resolveMergeTarget(queryFn, row) {
  let current = row;
  for (let hop = 0; current?.merged_into && hop < MAX_MERGE_HOPS; hop += 1) {
    const { rows } = await queryFn(
      `SELECT ${COLUMNS} FROM aviz_known_addresses WHERE id = $1`,
      [current.merged_into],
    );
    if (!rows[0]) return null;
    current = rows[0];
  }
  return current?.merged_into ? null : current;
}

export class AddressMergeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Fold `sourceId` (a misread, e.g. Kepublicii) into `targetId` (the real address).
 * Run inside a transaction: `queryFn` must be the transaction client's query.
 *
 * - documents that showed the misread now count for the real address, each once;
 * - the real address keeps its text and becomes confirmed (a person just vouched for it);
 * - the misread stays, disabled, with `merged_into` set, so it is never learned again.
 */
export async function mergeKnownAddresses(queryFn, { sourceId, targetId, userId = null } = {}) {
  if (!sourceId || !targetId || sourceId === targetId) {
    throw new AddressMergeError('same', 'O adresă nu poate fi unită cu ea însăși.');
  }
  const { rows } = await queryFn(
    `SELECT ${COLUMNS} FROM aviz_known_addresses WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [[sourceId, targetId]],
  );
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) throw new AddressMergeError('not_found', 'Adresa nu a fost găsită.');
  if (source.company_id !== target.company_id) {
    throw new AddressMergeError('other_company', 'Adresele sunt la firme diferite.');
  }
  if (source.role !== target.role) {
    throw new AddressMergeError('other_role', 'Un depozit de expeditor nu se unește cu o adresă de livrare.');
  }
  if (source.merged_into) throw new AddressMergeError('already_merged', 'Adresa e deja unită cu alta.');
  if (target.merged_into) throw new AddressMergeError('target_merged', 'Adresa țintă e ea însăși o variantă unită.');
  // A disabled target is never offered for filling: folding sightings into it would just
  // switch the real address off along with the misread.
  if (target.disabled) throw new AddressMergeError('target_disabled', 'Adresa țintă e dezactivată. Reactiveaz-o înainte de unire.');

  // Earlier misreads of the misread now point straight at the real address.
  await queryFn(
    `UPDATE aviz_known_addresses SET merged_into = $1, updated_at = NOW() WHERE merged_into = $2`,
    [targetId, sourceId],
  );

  const sourceSightings = await queryFn(
    `SELECT count(*)::int AS n FROM aviz_known_address_sightings WHERE address_id = $1`,
    [sourceId],
  );
  const moved = await queryFn(
    `INSERT INTO aviz_known_address_sightings (address_id, document_id, created_at)
     SELECT $1, document_id, created_at FROM aviz_known_address_sightings WHERE address_id = $2
     ON CONFLICT DO NOTHING
     RETURNING document_id`,
    [targetId, sourceId],
  );
  await queryFn(`DELETE FROM aviz_known_address_sightings WHERE address_id = $1`, [sourceId]);
  // A document that showed both forms is one sighting, not two.
  const duplicates = Math.max(0, (sourceSightings.rows[0]?.n || 0) - moved.rowCount);
  const addedSeen = Math.max(0, (source.seen_count || 0) - duplicates);

  const merged = await queryFn(
    `UPDATE aviz_known_addresses SET
       seen_count = seen_count + $2,
       used_count = used_count + $3,
       last_seen_at = GREATEST(last_seen_at, $4::timestamptz),
       last_used_at = GREATEST(last_used_at, $5::timestamptz),
       verified = TRUE,
       updated_by = COALESCE($6, updated_by),
       updated_at = NOW()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [targetId, addedSeen, source.used_count || 0, source.last_seen_at, source.last_used_at, userId],
  );
  await queryFn(
    `UPDATE aviz_known_addresses SET
       merged_into = $2, disabled = TRUE, verified = FALSE,
       updated_by = COALESCE($3, updated_by), updated_at = NOW()
     WHERE id = $1`,
    [sourceId, targetId, userId],
  );
  return { target: merged.rows[0], source, addedSeen, duplicates };
}

/** Best-effort counter: how often an address filled a document. */
export async function recordAddressUse(queryFn, addressId) {
  if (!addressId) return;
  await queryFn(
    `UPDATE aviz_known_addresses SET used_count = used_count + 1, last_used_at = NOW()
     WHERE id = $1`,
    [addressId],
  );
}
