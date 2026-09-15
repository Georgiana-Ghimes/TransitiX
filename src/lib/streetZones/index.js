/**
 * Looking a street up in the shipped index, instead of sending it to a geocoder.
 *
 * Nothing here touches the network. That is the point: the alternative sends whatever an
 * operator types, routinely a customer's delivery address, to a third party on every
 * keystroke of a search, and for this question it buys nothing. A street's zones do not depend
 * on the house number often enough to be worth the exposure, and where they do, this says so.
 *
 * The index itself is a few hundred kilobytes per city, so it is loaded on first use rather
 * than with the page. A map that nobody searches never pays for it.
 */
import {
  houseNumberValue, normalizeStreetName, splitStreetAndNumber, streetNameWithoutType,
} from '../streetName.js';

/** Cities with a built index. Adding one means generating it and adding a line here. */
const LOADERS = {
  bucuresti: () => import('./bucuresti.js'),
};

const cache = new Map();

export function hasStreetIndex(cityId) {
  return Object.prototype.hasOwnProperty.call(LOADERS, cityId);
}

/**
 * Loads a city's index once and keeps it.
 *
 * The in-flight promise is cached, not just the result, so a fast typist does not start the
 * download several times over.
 */
export function loadStreetIndex(cityId) {
  if (!hasStreetIndex(cityId)) return Promise.resolve(null);
  if (!cache.has(cityId)) {
    cache.set(cityId, LOADERS[cityId]().then((mod) => {
      const byKey = new Map();
      const byBareName = new Map();
      const numbers = new Map();
      for (const [key, odd, even] of mod.STREET_NUMBERS ?? []) numbers.set(key, { odd, even });
      for (const [key, label, zones] of mod.STREETS) {
        const entry = { key, label, zones: parseZones(zones) };
        byKey.set(key, entry);
        // Every street sharing a bare name is kept, never just the first. "Dacia" is both
        // Strada Dacia, which is outside every zone, and Bulevardul Dacia, which runs into
        // Zone A, picking one silently is a coin flip between "free" and "3.534 lei".
        const bare = streetNameWithoutType(key);
        if (!byBareName.has(bare)) byBareName.set(bare, []);
        byBareName.get(bare).push(entry);
      }
      return { cityId, byKey, byBareName, numbers, all: [...byKey.values()] };
    }).catch((err) => {
      // A failed chunk must not be remembered as "this city has no streets".
      cache.delete(cityId);
      throw err;
    }));
  }
  return cache.get(cityId);
}

/** `'ZA:f,ZB:p'` → `[{ code: 'ZA', whole: true }, { code: 'ZB', whole: false }]` */
function parseZones(value) {
  return String(value || '')
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const [code, cover] = part.split(':');
      return { code, whole: cover === 'f' };
    });
}

/**
 * What the index knows about a typed street.
 *
 * `found` carries the street; `status` says how confident that is:
 *   exact: the name matched, type word and all
 *   without-type: one street matched once the type word was ignored; the screen shows which
 *   ambiguous: several streets share that bare name and they do not agree on the answer, so
 *     the operator picks. Guessing here is the difference between a street that costs nothing
 *     and one that costs thousands of lei
 *   unknown: nothing matched. That is not the same as "outside the zones", and callers must
 *     not present it as one: an unknown street is a spelling we do not have, while a known
 *     street with no zones is genuinely unrestricted.
 */
export function lookupStreet(index, query) {
  const raw = String(query || '').trim();
  if (!index || !raw) return { status: 'unknown', query: raw, found: null, suggestions: [] };

  const key = normalizeStreetName(raw);
  const exact = index.byKey.get(key);
  if (exact) return { status: 'exact', query: raw, found: exact, suggestions: [] };

  const bare = index.byBareName.get(streetNameWithoutType(raw)) ?? [];
  const settled = settle(bare, raw);
  if (settled) return settled;

  const suggestions = suggestStreets(index, raw, 6);
  return settle(suggestions, raw)
    ?? { status: 'unknown', query: raw, found: null, suggestions };
}

/** The zones a street lies in, as a string two streets can be compared by. */
function zoneSignature(entry) {
  return entry.zones.map((z) => `${z.code}:${z.whole ? 'f' : 'p'}`).join(',');
}

/**
 * Turns a set of candidates into an answer, when they allow one.
 *
 * Several streets can share a name and still not be a question worth asking: Bucharest has an
 * Intrarea, a Piața and a Strada Baba Novac and all three sit in Zone B, so making somebody
 * choose is friction that teaches them to click past the prompt. The question is only real when
 * the candidates disagree, as Strada Dacia and Bulevardul Dacia do, one costing nothing and
 * the other up to 3.534 lei a day.
 */
function settle(candidates, raw) {
  if (!candidates.length) return null;
  if (candidates.length === 1) {
    return { status: 'without-type', query: raw, found: candidates[0], suggestions: [] };
  }
  const signatures = new Set(candidates.map(zoneSignature));
  if (signatures.size === 1) {
    return {
      status: 'without-type',
      query: raw,
      found: candidates[0],
      sharedWith: candidates.length,
      suggestions: [],
    };
  }
  return { status: 'ambiguous', query: raw, found: null, suggestions: candidates };
}

/**
 * Streets that contain every word typed, in any order.
 *
 * Word matching rather than a contiguous substring, because Romanian street names carry the
 * full official name and nobody types it: OSM has "Bulevardul General Gheorghe Magheru" and an
 * operator writes "bd. Magheru". Substring matching found nothing at all for that, not even a
 * suggestion, which is the worst possible answer for a street that plainly exists.
 *
 * Ranked by how much of the name the words account for, so an exact-length hit comes first and
 * a long name that merely contains the word comes after.
 */
export function suggestStreets(index, query, limit = 8) {
  if (!index) return [];
  const words = normalizeStreetName(query).split(' ').filter((w) => w.length >= 2);
  if (!words.length) return [];

  const scored = [];
  for (const entry of index.all) {
    const hay = entry.key;
    if (!words.every((word) => hay.includes(word))) continue;
    const matched = words.reduce((n, word) => n + word.length, 0);
    scored.push({ entry, extra: hay.length - matched });
  }

  return scored
    .sort((a, b) => a.extra - b.extra || a.entry.key.localeCompare(b.entry.key, 'ro'))
    .slice(0, limit)
    .map((s) => s.entry);
}

/**
 * The one zone an operator should act on, and whether the street settles it.
 *
 * Zones nest, Bucharest's A sits inside B, so a street can legitimately be in both. The
 * strictest one that applies is the answer, and `certain` is false when the street only partly
 * lies in it, which is the case where the house number decides and the map has to be consulted.
 */
export function effectiveZone(entry, cityZones = []) {
  if (!entry?.zones?.length) return null;
  const rank = new Map(cityZones.map((z) => [z.code, z.priority ?? 0]));
  const sorted = [...entry.zones].sort((a, b) => (rank.get(b.code) ?? 0) - (rank.get(a.code) ?? 0));
  const strictest = sorted[0];
  return {
    code: strictest.code,
    certain: strictest.whole,
    all: sorted,
  };
}

/**
 * The zone of one house number on one street.
 *
 * Ranges are per parity because a boundary that follows a street puts the odd side inside and
 * the even side out. A number between two ranges is only answered when those ranges agree,
 * interpolating across a boundary is precisely the guess this index exists to avoid.
 *
 * Returns null when there is nothing to go on, which the caller must report as "no data for
 * that number", never as "outside the zones".
 */
export function zoneForNumber(index, streetKey, houseNumber) {
  const value = houseNumberValue(houseNumber);
  if (value == null) return null;
  const sides = index?.numbers?.get(streetKey);
  if (!sides) return null;

  const ranges = value % 2 === 1 ? sides.odd : sides.even;
  if (!ranges?.length) return null;

  const hit = ranges.find(([from, to]) => value >= from && value <= to);
  if (hit) return { zone: hit[2] || null, certain: true, number: value };

  const before = [...ranges].reverse().find(([, to]) => to < value);
  const after = ranges.find(([from]) => from > value);
  if (before && after && before[2] === after[2]) {
    // Both neighbours on this side of the street agree, so the gap between them does too.
    return { zone: before[2] || null, certain: true, number: value, interpolated: true };
  }
  if (before && after) {
    return {
      zone: null,
      certain: false,
      number: value,
      between: [before[2] || null, after[2] || null],
    };
  }
  return null;
}

/**
 * A street and, when one was typed, a house number.
 *
 * The whole string is tried as a street name first. Only if no such street exists is a trailing
 * number split off, "Bulevardul 1 Decembrie 1918" is a street, "Calea Victoriei 12" is not, and
 * no rule about digits can tell those apart. The index can.
 */
export function lookupAddress(index, query) {
  // Only the exact and bare-name paths count as "this whole string is a street". The fuzzy
  // suggestion pass drops single characters, so it happily matched "Bd. Dacia 5" to Bulevardul
  // Dacia and swallowed the number, the one part of the query that decides the answer there.
  const key = normalizeStreetName(query);
  const bare = index?.byBareName?.get(streetNameWithoutType(query)) ?? [];
  if (index?.byKey?.has(key) || bare.length) {
    return { ...lookupStreet(index, query), number: null };
  }

  const { street, number } = splitStreetAndNumber(query);
  if (number) {
    const withoutNumber = lookupStreet(index, street);
    if (withoutNumber.status !== 'unknown') return { ...withoutNumber, query, number };
  }
  return { ...lookupStreet(index, query), number: null };
}

/**
 * The answer for a whole address: which zone, how sure, and what would make it surer.
 *
 * The street is consulted first and settles it whenever it lies wholly inside a zone, asking
 * for a house number there would be busywork. The number is only decisive on the streets a
 * boundary runs through, which is exactly where the index carries numbers.
 */
export function resolveAddress(index, lookup, cityZones = []) {
  const entry = lookup?.found;
  if (!entry) return null;

  const street = effectiveZone(entry, cityZones);

  // Wholly inside, or wholly outside: the number cannot change either.
  if (!street) return { zone: null, certain: true, source: 'street' };
  if (street.certain) return { zone: street.code, certain: true, source: 'street' };

  if (!lookup.number) {
    return { zone: street.code, certain: false, source: 'street', needsNumber: true };
  }

  const byNumber = zoneForNumber(index, entry.key, lookup.number);
  if (!byNumber) {
    return {
      zone: street.code, certain: false, source: 'street', numberUnknown: true,
    };
  }
  if (!byNumber.certain) {
    return {
      zone: null, certain: false, source: 'number', between: byNumber.between,
    };
  }
  return {
    zone: byNumber.zone,
    certain: true,
    source: 'number',
    interpolated: Boolean(byNumber.interpolated),
  };
}
