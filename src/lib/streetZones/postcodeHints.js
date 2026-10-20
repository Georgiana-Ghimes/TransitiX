/**
 * Bucharest delivery postcodes → street index key.
 *
 * The street index has no postcodes of its own. When OCR / Rută loses the type word, glues
 * the house number into the name, or prefixes a company (`CONCELEX SRL, Șosea Viilor…`),
 * `lookupStreet` answers "unknown" for a street we plainly carry. These codes are the ones
 * that show up under Adresa de livrare on high-volume sheets; each maps to exactly one
 * index key so the zone fee can still be computed.
 *
 * Keys are six-digit Romanian postcodes. Values are `normalizeStreetName` keys from
 * `bucuresti.js`. Add a row only when the code uniquely identifies that street.
 */
export const BUCURESTI_POSTCODE_STREETS = {
  // Șoseaua Viilor nr. 52, Sector 5 — Baumit / Concelex (PSL-0060741 and siblings).
  '050151': 'soseaua viilor',
};

/**
 * City with a zone index implied by a Romanian postcode.
 * București sectors use 01xxxx–06xxxx (same rule as server `localityHintFromPostcode`).
 */
export function cityIdFromRoPostcode(postcode) {
  const pc = String(postcode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(pc)) return null;
  const prefix = Number(pc.slice(0, 2));
  if (prefix >= 1 && prefix <= 6) return 'bucuresti';
  return null;
}

/** Index street key for a known delivery postcode, or null. */
export function streetKeyFromPostcode(postcode) {
  const pc = String(postcode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(pc)) return null;
  return BUCURESTI_POSTCODE_STREETS[pc] || null;
}
