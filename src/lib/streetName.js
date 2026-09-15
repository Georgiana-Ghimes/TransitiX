/**
 * Turning what somebody types into something a street index can be looked up by.
 *
 * Romanian street names carry a type word (Strada, Bulevardul, Calea, Șoseaua) that is
 * abbreviated a dozen ways in practice and often left out entirely. OSM spells it in full,
 * an operator types "bd dacia", and a document says "B-dul Dacia". All three have to reach the
 * same row, so the type word is normalised to a marker rather than compared literally.
 *
 * The type word is kept, not dropped: "Strada Nicolae Iorga" and "Calea Nicolae Iorga" would be
 * different streets, and collapsing them would hand one street's zone to the other. What gets
 * normalised is only how the same type word is spelled.
 */

/** Lowercase, without diacritics, "Șoseaua" and "Soseaua" must not be different streets. */
export function plainText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // OSM and Romanian keyboards disagree about the comma-below letters; NFD does not fold
    // the legacy cedilla forms, so they are mapped explicitly.
    .replace(/[şş]/g, 's')
    .replace(/[ţţ]/g, 't');
}

/**
 * Every spelling of a street type that maps onto one canonical marker.
 * Longest forms first so "bulevardul" is not matched as "bd" plus leftovers.
 */
const STREET_TYPES = [
  ['bulevardul', 'bulevard', 'b-dul', 'bdul', 'b dul', 'bd', 'blvd'],
  ['soseaua', 'sos'],
  ['calea', 'cal'],
  ['strada', 'str'],
  ['piata', 'pta', 'pt'],
  ['aleea', 'al'],
  ['intrarea', 'intr', 'int'],
  ['splaiul', 'spl'],
  ['drumul', 'dr'],
  ['prelungirea', 'prel'],
  ['pasajul', 'pasaj'],
  ['bulevardul'],
];

const TYPE_LOOKUP = new Map();
for (const [canonical, ...aliases] of STREET_TYPES) {
  TYPE_LOOKUP.set(canonical, canonical);
  for (const alias of aliases) TYPE_LOOKUP.set(alias, canonical);
}

/**
 * The key a street is stored and looked up by: canonical type + the rest of the name.
 *
 * A name with no recognised type word keeps its words as they are, plenty of Bucharest streets
 * are known by a bare name, and inventing "strada" in front of one would stop it matching the
 * row the index actually built.
 */
export function normalizeStreetName(value) {
  const plain = plainText(value)
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';

  const words = plain.split(' ');
  // Try the two-word forms ("b dul") before the one-word ones.
  const twoWord = words.length > 2 ? TYPE_LOOKUP.get(`${words[0]} ${words[1]}`) : null;
  if (twoWord) return `${twoWord} ${words.slice(2).join(' ')}`.trim();

  const oneWord = TYPE_LOOKUP.get(words[0]);
  if (oneWord && words.length > 1) return `${oneWord} ${words.slice(1).join(' ')}`.trim();

  return plain;
}

/**
 * The same key with the type word removed, for a second pass.
 *
 * Somebody who types "dacia" should still find "Bulevardul Dacia" when nothing else matches,
 * but only as a fallback, because dropping the type word is what makes two genuinely different
 * streets look identical.
 */
export function streetNameWithoutType(value) {
  const key = normalizeStreetName(value);
  const words = key.split(' ');
  if (words.length > 1 && TYPE_LOOKUP.has(words[0])) return words.slice(1).join(' ');
  return key;
}

/**
 * Splits "Calea Victoriei 12A" into the street and a trailing house number.
 *
 * This cannot be decided by shape alone and does not try: "Bulevardul 1 Decembrie 1918" splits
 * here into a street and the number 1918, which is wrong, 1918 is part of the name. The caller
 * resolves that by asking the index for the whole string first and only splitting when no such
 * street exists, which is the only test that actually knows the difference.
 */
export function splitStreetAndNumber(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return { street: '', number: null };

  const match = raw.match(/^(.*?)[\s,]+(?:nr\.?\s*)?(\d{1,5}[A-Za-z]?(?:[-/]\d{1,5}[A-Za-z]?)?)$/i);
  if (!match) return { street: raw, number: null };

  const street = match[1].trim();
  // A street whose whole name would vanish is not a street plus a number.
  if (!street || !/[A-Za-zÀ-ž]/.test(street)) return { street: raw, number: null };
  return { street, number: match[2] };
}

/** The leading integer of a house number: "128A" to 128, "18-20" to 18, "bis" to null. */
export function houseNumberValue(value) {
  const match = String(value || '').trim().match(/^(\d{1,5})/);
  return match ? Number(match[1]) : null;
}
