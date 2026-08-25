/**
 * Romanian address parsing and normalization.
 *
 * Addresses in Transitix are one free-text field ("Cluj-Napoca, str. Fabricii 12") with no
 * separate city or county column, so everything downstream — deduping locations, keying the
 * geocode cache, judging whether a geocode is likely to succeed — starts here.
 *
 * The output is deliberately conservative: this module never invents a coordinate, only a
 * normalized shape and an honest score for how geocodable the address looks.
 */

const DIACRITICS = {
  ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't',
  Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ş: 'S', Ț: 'T', Ţ: 'T',
};

export function stripDiacritics(value) {
  return String(value || '')
    .replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (ch) => DIACRITICS[ch] || ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Only unambiguous abbreviations are canonicalized. "Dr." and "Al." are left alone on purpose:
 * they appear inside street names ("Str. Dr. Felix") and merging them would fuse addresses
 * that are not the same place.
 */
const ABBREVIATIONS = new Map(Object.entries({
  str: 'strada', stra: 'strada', strada: 'strada',
  bd: 'bulevardul', bdul: 'bulevardul', blv: 'bulevardul', blvd: 'bulevardul',
  bulevard: 'bulevardul', bulevardul: 'bulevardul',
  sos: 'soseaua', soseaua: 'soseaua',
  cal: 'calea', calea: 'calea',
  pta: 'piata', piata: 'piata',
  nr: 'nr', no: 'nr', numarul: 'nr',
  bl: 'bl', blocul: 'bl',
  sc: 'sc', scara: 'sc',
  ap: 'ap', apartament: 'ap', apartamentul: 'ap',
  et: 'et', etaj: 'et', etajul: 'et',
  jud: 'jud', judetul: 'jud', judet: 'jud',
  com: 'com', comuna: 'com',
  sat: 'sat', satul: 'sat',
  mun: 'mun', municipiul: 'mun',
  or: 'oras', oras: 'oras', orasul: 'oras',
}));

const STREET_TYPES = new Set([
  'strada', 'bulevardul', 'soseaua', 'calea', 'aleea', 'piata', 'intrarea',
  'drumul', 'splaiul', 'prelungirea', 'zona', 'parcul', 'cartierul', 'dn', 'km',
]);

const RURAL_MARKERS = new Set(['sat', 'com']);

/** Județ capitals and other towns that show up often in freight. Keys are diacritic-free. */
const CITY_COUNTY = new Map(Object.entries({
  bucuresti: 'B', otopeni: 'IF', voluntari: 'IF', buftea: 'IF', pantelimon: 'IF',
  'popesti leordeni': 'IF', bragadiru: 'IF', chitila: 'IF', chiajna: 'IF', magurele: 'IF',
  'cluj napoca': 'CJ', turda: 'CJ', dej: 'CJ', 'campia turzii': 'CJ',
  timisoara: 'TM', lugoj: 'TM',
  iasi: 'IS', pascani: 'IS',
  constanta: 'CT', mangalia: 'CT', medgidia: 'CT', navodari: 'CT',
  craiova: 'DJ', calafat: 'DJ',
  brasov: 'BV', fagaras: 'BV', sacele: 'BV', codlea: 'BV',
  galati: 'GL', tecuci: 'GL',
  ploiesti: 'PH', campina: 'PH',
  oradea: 'BH', salonta: 'BH',
  braila: 'BR',
  arad: 'AR',
  pitesti: 'AG', mioveni: 'AG', campulung: 'AG',
  sibiu: 'SB', medias: 'SB',
  bacau: 'BC', onesti: 'BC', moinesti: 'BC',
  'targu mures': 'MS', reghin: 'MS', sighisoara: 'MS',
  'baia mare': 'MM', 'sighetu marmatiei': 'MM',
  buzau: 'BZ', 'ramnicu sarat': 'BZ',
  botosani: 'BT', dorohoi: 'BT',
  'satu mare': 'SM', carei: 'SM',
  'ramnicu valcea': 'VL',
  'drobeta turnu severin': 'MH',
  suceava: 'SV', radauti: 'SV', falticeni: 'SV',
  'piatra neamt': 'NT', roman: 'NT',
  'targu jiu': 'GJ', motru: 'GJ',
  targoviste: 'DB',
  focsani: 'VN', adjud: 'VN',
  bistrita: 'BN',
  resita: 'CS', caransebes: 'CS',
  tulcea: 'TL',
  slatina: 'OT', caracal: 'OT',
  calarasi: 'CL', oltenita: 'CL',
  'alba iulia': 'AB', sebes: 'AB', aiud: 'AB',
  giurgiu: 'GR',
  deva: 'HD', hunedoara: 'HD', petrosani: 'HD', orastie: 'HD',
  zalau: 'SJ',
  'sfantu gheorghe': 'CV', 'targu secuiesc': 'CV',
  vaslui: 'VS', barlad: 'VS', husi: 'VS',
  slobozia: 'IL', fetesti: 'IL', urziceni: 'IL',
  alexandria: 'TR', 'rosiorii de vede': 'TR', 'turnu magurele': 'TR',
  'miercurea ciuc': 'HR', 'odorheiu secuiesc': 'HR', gheorgheni: 'HR',
}));

/** Județ names → plate codes, for addresses that spell the county out ("jud. Prahova"). */
const COUNTY_CODES = new Map(Object.entries({
  alba: 'AB', arad: 'AR', arges: 'AG', bacau: 'BC', bihor: 'BH', 'bistrita nasaud': 'BN',
  botosani: 'BT', braila: 'BR', brasov: 'BV', bucuresti: 'B', buzau: 'BZ',
  calarasi: 'CL', 'caras severin': 'CS', cluj: 'CJ', constanta: 'CT', covasna: 'CV',
  dambovita: 'DB', dolj: 'DJ', galati: 'GL', giurgiu: 'GR', gorj: 'GJ', harghita: 'HR',
  hunedoara: 'HD', ialomita: 'IL', iasi: 'IS', ilfov: 'IF', maramures: 'MM', mehedinti: 'MH',
  mures: 'MS', neamt: 'NT', olt: 'OT', prahova: 'PH', salaj: 'SJ', 'satu mare': 'SM',
  sibiu: 'SB', suceava: 'SV', teleorman: 'TR', timis: 'TM', tulcea: 'TL', valcea: 'VL',
  vaslui: 'VS', vrancea: 'VN',
}));

/** Valid județ plate codes, for addresses that carry the code rather than the name. */
const COUNTY_CODE_SET = new Set(COUNTY_CODES.values());

function tokenize(segment) {
  return stripDiacritics(segment)
    .toLowerCase()
    // hyphens become spaces so "Cluj-Napoca" and "Cluj Napoca" key identically
    .replace(/[.,;:()/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function canonicalTokens(segment) {
  return tokenize(segment).map((token) => ABBREVIATIONS.get(token) || token);
}

function cleanSegment(segment) {
  return String(segment || '').replace(/\s+/g, ' ').trim();
}

function lookupCity(tokens) {
  // Try the longest run of leading words first, so "targu mures" beats "targu".
  for (let len = Math.min(3, tokens.length); len >= 1; len -= 1) {
    const candidate = tokens.slice(0, len).join(' ');
    if (CITY_COUNTY.has(candidate)) return { city: candidate, county: CITY_COUNTY.get(candidate) };
  }
  return null;
}

/**
 * Splits a free-text Romanian address into the parts a geocoder actually wants.
 * Returns nulls rather than guesses when a part is genuinely absent.
 */
export function parseRomanianAddress(raw) {
  const original = cleanSegment(raw);
  if (!original) {
    return {
      raw: '', street: null, city: null, county: null, postcode: null,
      isRural: false, hasStreetType: false, hasHouseNumber: false, cityKnown: false,
    };
  }

  const segments = original.split(',').map(cleanSegment).filter(Boolean);
  const postcode = original.match(/\b(\d{6})\b/)?.[1] || null;

  let city = null;
  let cityKnown = false;
  let county = null;
  let isRural = false;
  const streetParts = [];

  for (const segment of segments) {
    const tokens = canonicalTokens(segment);
    if (!tokens.length) continue;

    if (tokens[0] === 'jud') {
      const name = tokens.slice(1).join(' ');
      county = COUNTY_CODES.get(name)
        || (COUNTY_CODE_SET.has(name.toUpperCase()) ? name.toUpperCase() : county);
      continue;
    }

    // A lone plate code ("..., CJ") is the county, not part of the street. Without this it
    // gets appended to the street and corrupts the address_key.
    if (tokens.length === 1 && COUNTY_CODE_SET.has(tokens[0].toUpperCase())) {
      county = county || tokens[0].toUpperCase();
      continue;
    }

    if (RURAL_MARKERS.has(tokens[0])) {
      isRural = true;
      // "sat Cornu" names the settlement; "com. Brebu" names the parent commune.
      if (!city && tokens[0] === 'sat') city = tokens.slice(1).join(' ') || null;
      else if (!city) city = tokens.slice(1).join(' ') || null;
      continue;
    }

    if (tokens[0] === 'mun' || tokens[0] === 'oras') {
      const rest = tokens.slice(1);
      const hit = lookupCity(rest);
      city = hit ? hit.city : rest.join(' ') || city;
      if (hit) { county = county || hit.county; cityKnown = true; }
      continue;
    }

    // Check the city first: "Timisoara Calea Aradului 50" arrives as one comma-less segment
    // holding both, and treating it as pure street would lose the locality entirely.
    const hit = lookupCity(tokens);
    if (hit && !cityKnown) {
      city = hit.city;
      county = county || hit.county;
      cityKnown = true;
      const rest = tokens.slice(hit.city.split(' ').length);
      if (rest.length) streetParts.push(rest.join(' '));
      continue;
    }

    if (tokens.some((t) => STREET_TYPES.has(t))) {
      streetParts.push(segment);
      continue;
    }

    // No street keyword and not a known city: the first such segment is most likely the
    // locality, anything after it is address detail (block, entrance, landmark).
    if (!city) city = tokens.join(' ');
    else streetParts.push(segment);
  }

  const street = streetParts.length ? streetParts.join(', ') : null;
  const streetTokens = street ? canonicalTokens(street) : [];
  const houseNumber = extractHouseNumber(streetTokens);

  return {
    raw: original,
    street,
    city: city || null,
    county,
    postcode,
    houseNumber,
    isRural,
    cityKnown,
    hasStreetType: streetTokens.some((t) => STREET_TYPES.has(t)),
    hasHouseNumber: Boolean(houseNumber),
  };
}

/** Tokens after which any number is an internal detail, not the house number. */
const INTERNAL_MARKERS = new Set(['bl', 'sc', 'ap', 'et']);

/**
 * The distinguishing words of a street, with the type word and every number removed.
 *
 * Comparing full street strings is a trap: "Calea Aradului" and "Calea Torontalului" share
 * "calea", so a naive overlap check calls two different streets a match. Only the name
 * carries identity.
 */
export function streetNameTokens(street) {
  const tokens = [];
  for (const token of canonicalTokens(street || '')) {
    // Everything from "bl."/"sc."/"ap." onward is interior detail, including its value.
    if (INTERNAL_MARKERS.has(token)) break;
    if (STREET_TYPES.has(token) || token === 'nr' || /^\d/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/**
 * Pulls the house number out of a street. Harder than a regex: street names contain numbers
 * ("Strada 1 Decembrie 1918 nr. 5") and trailing numbers are often block/stair/flat details
 * ("Bd. Unirii 1, bl. A2, ap. 45").
 */
export function extractHouseNumber(streetTokens) {
  const tokens = Array.isArray(streetTokens) ? streetTokens : canonicalTokens(streetTokens || '');
  if (!tokens.length) return null;

  const isNumber = (token) => /^\d+[a-z]?$/.test(token);

  // An explicit "nr" wins outright — that is the author telling us which number matters.
  const nrIndex = tokens.indexOf('nr');
  if (nrIndex !== -1) {
    const candidate = tokens[nrIndex + 1];
    if (candidate && isNumber(candidate)) return candidate;
  }

  // Otherwise take the last number before any block/stair/flat marker.
  let found = null;
  for (const token of tokens) {
    if (INTERNAL_MARKERS.has(token)) break;
    if (isNumber(token)) found = token;
  }
  return found;
}

/**
 * Stable dedupe key and geocode-cache key. Two spellings of the same place must collapse
 * to the same string ("str. Fabricii 12" and "Strada Fabricii nr. 12"), and two different
 * places must not.
 */
export function addressKey(input) {
  const parsed = typeof input === 'string' ? parseRomanianAddress(input) : input;
  if (!parsed?.raw && !parsed?.city && !parsed?.street) return null;

  const street = canonicalTokens(parsed.street || '')
    // "nr" is punctuation-grade noise: "Fabricii 12" and "Fabricii nr. 12" are one address.
    .filter((token) => token !== 'nr')
    .join(' ');
  const city = canonicalTokens(parsed.city || '').join(' ');
  const county = parsed.county ? String(parsed.county).toLowerCase() : '';

  const key = [county, city, street].filter(Boolean).join('|');
  if (key) return key;

  const fallback = canonicalTokens(parsed.raw || '').join(' ');
  return fallback || null;
}

/**
 * How likely is this address to geocode to the right building?
 * Score is a prediction, not a measurement — it decides review priority, nothing more.
 */
export function assessAddress(input) {
  const parsed = typeof input === 'string' ? parseRomanianAddress(input) : input;
  const flags = [];
  let score = 0;

  if (!parsed?.raw) {
    return { score: 0, tier: 'poor', flags: ['fara_adresa'], parsed };
  }

  if (parsed.cityKnown) score += 0.4;
  else if (parsed.city) { score += 0.2; flags.push('oras_nerecunoscut'); }
  else flags.push('fara_oras');

  if (parsed.hasStreetType) score += 0.2;
  else flags.push('fara_tip_strada');

  if (parsed.hasHouseNumber) score += 0.2;
  else flags.push('fara_numar');

  if (parsed.county) score += 0.2;
  else flags.push('fara_judet');

  // Without a house number the best any geocoder can do is the middle of the street,
  // which is not a delivery point — those always need a human to drop the pin.
  if (!parsed.hasHouseNumber) score = Math.min(score, 0.75);

  if (parsed.isRural) {
    flags.push('rural');
    // Rural addresses geocode to the village centre at best, so cap the optimism further.
    score = Math.min(score, 0.6);
  }

  score = Math.round(Math.min(1, score) * 100) / 100;
  const tier = score >= 0.8 ? 'good' : score >= 0.5 ? 'review' : 'poor';
  return { score, tier, flags, parsed };
}
