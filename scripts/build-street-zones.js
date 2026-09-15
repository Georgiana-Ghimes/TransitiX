/**
 * Builds the street → zone index the map searches, so no address ever leaves the server.
 *
 * The alternative was a geocoder, which means sending whatever an operator types, often a
 * customer's delivery address, to a third party on every lookup. For this question we do not
 * need one: the zones are fixed polygons and a city has a few thousand street names, so which
 * zones a street touches can be decided once, here, and shipped as data.
 *
 * It is also the more honest answer. A geocoder returns one pin for a street that may run for
 * kilometres, and several of Bucharest's zone boundaries *follow* a street, so that pin lands
 * on one side or the other with confidence it has not earned. This records every zone a street
 * lies in each zone, so the screen can say "crosses the boundary, the house number decides"
 * instead of guessing.
 *
 * Usage:
 *   node scripts/build-street-zones.js                 # all cities in the reference
 *   node scripts/build-street-zones.js bucuresti       # one city
 *   node scripts/build-street-zones.js --cache <file>       # reuse a saved street response
 *   node scripts/build-street-zones.js --addresses <file>   # reuse a saved address dump
 *   node scripts/build-street-zones.js --no-addresses       # streets only, skip house numbers
 *
 * Output: src/lib/streetZones/<cityId>.js, regenerated in full each run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZONE_CITIES } from '../src/lib/zoneReference.js';
import { geometryBounds, pointInGeometry } from '../src/lib/zoneGeometry.js';
import { normalizeStreetName } from '../src/lib/streetName.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '..', 'src', 'lib', 'streetZones');
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Bounds wide enough to catch a street that leaves the outermost zone and comes back. */
function queryBbox(city) {
  const boxes = city.zones.map((z) => geometryBounds(z.outline)).filter(Boolean);
  const south = Math.min(...boxes.map((b) => b[0][0]));
  const west = Math.min(...boxes.map((b) => b[0][1]));
  const north = Math.max(...boxes.map((b) => b[1][0]));
  const east = Math.max(...boxes.map((b) => b[1][1]));
  const pad = 0.02;
  return [south - pad, west - pad, north + pad, east + pad]
    .map((n) => n.toFixed(4)).join(',');
}

async function fetchStreets(city) {
  const bbox = queryBbox(city);
  const query = `[out:json][timeout:260][bbox:${bbox}];way["highway"]["name"];out geom;`;
  process.stdout.write(`  interoghez Overpass (bbox ${bbox})…\n`);
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Transitix street-zone builder' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass a răspuns ${res.status}`);
  return res.json();
}

/**
 * Which zones a street touches.
 *
 * Every node of every segment is tested, not a centroid: a street that runs from the centre
 * outwards belongs to both zones it passes through, and averaging its points would place it in
 * whichever one happens to hold the middle.
 */
function classify(elements, city) {
  const byStreet = new Map();

  for (const way of elements) {
    const name = way?.tags?.name;
    const geometry = way?.geometry;
    if (!name || !Array.isArray(geometry)) continue;

    const key = normalizeStreetName(name);
    if (!key) continue;

    let entry = byStreet.get(key);
    if (!entry) {
      entry = { key, labels: new Map(), nodes: 0, inside: new Map(), segments: 0 };
      byStreet.set(key, entry);
    }
    entry.labels.set(name, (entry.labels.get(name) ?? 0) + 1);
    entry.segments += 1;

    for (const node of geometry) {
      entry.nodes += 1;
      const point = [node.lat, node.lon];
      for (const zone of city.zones) {
        if (pointInGeometry(point, zone.outline)) {
          entry.inside.set(zone.code, (entry.inside.get(zone.code) ?? 0) + 1);
        }
      }
    }
  }
  return byStreet;
}

/**
 * `f` when every node of the street is inside the zone, `p` when only some are.
 *
 * This distinction is what makes the index worth having. Zone A sits inside Zone B, so every
 * street in A is also in B, and a plain list of zones cannot tell "this street is in Zone A"
 * from "this street leaves Zone A halfway along". The first deserves a straight answer; the
 * second deserves being told that the house number decides.
 *
 * A few nodes outside are not rounded away: the boundary follows real streets, so a street
 * that pokes out at one end genuinely has addresses on both sides of it.
 */
function coverage(entry, code) {
  const hits = entry.inside.get(code) ?? 0;
  if (!hits) return null;
  return hits === entry.nodes ? 'f' : 'p';
}

// Overpass is a shared public service and refuses a whole-city address query: the street pass
// goes through in one request, the address pass does not. These are the tiles it does accept,
// with a pause between them, the 429 that follows a heavy query is the reason, not caution.
const ADDRESS_TILES = 4;
const TILE_PAUSE_MS = 45_000;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function tiles(city, per) {
  const boxes = city.zones.map((z) => geometryBounds(z.outline)).filter(Boolean);
  const south = Math.min(...boxes.map((b) => b[0][0])) - 0.02;
  const west = Math.min(...boxes.map((b) => b[0][1])) - 0.02;
  const north = Math.max(...boxes.map((b) => b[1][0])) + 0.02;
  const east = Math.max(...boxes.map((b) => b[1][1])) + 0.02;
  const dLat = (north - south) / per;
  const dLon = (east - west) / per;
  const out = [];
  for (let i = 0; i < per; i += 1) {
    for (let j = 0; j < per; j += 1) {
      out.push([south + i * dLat, west + j * dLon, south + (i + 1) * dLat, west + (j + 1) * dLon]
        .map((n) => n.toFixed(4)).join(','));
    }
  }
  return out;
}

/**
 * Address points, tile by tile, retried on the throttling this inevitably hits.
 *
 * A tile that never succeeds is reported and skipped rather than failing the build: the index
 * is allowed to be incomplete, a street with no data for a number says so, but it is never
 * allowed to be silently incomplete.
 */
async function fetchAddresses(city) {
  const rows = [];
  const missed = [];
  const boxes = tiles(city, ADDRESS_TILES);

  for (const [n, bbox] of boxes.entries()) {
    const query = `[out:csv("addr:street","addr:housenumber",::lat,::lon;false;"|")]`
      + `[timeout:200][bbox:${bbox}];node["addr:housenumber"]["addr:street"];out;`;
    let text = null;
    for (let attempt = 1; attempt <= 3 && text === null; attempt += 1) {
      /* eslint-disable no-await-in-loop */
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Transitix street-zone builder' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) text = await res.text();
      else await pause(TILE_PAUSE_MS * attempt);
      /* eslint-enable no-await-in-loop */
    }
    if (text === null) {
      missed.push(bbox);
      process.stdout.write(`    tile ${n + 1}/${boxes.length}: eșuat\n`);
    } else {
      for (const line of text.split('\n')) {
        const parts = line.split('|');
        if (parts.length < 4) continue;
        const lat = Number(parts[2]);
        const lon = Number(parts[3]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        rows.push({ street: parts[0], number: parts[1], lat, lon });
      }
      process.stdout.write(`    tile ${n + 1}/${boxes.length}: ${rows.length} adrese\n`);
    }
    // eslint-disable-next-line no-await-in-loop
    if (n < boxes.length - 1) await pause(TILE_PAUSE_MS);
  }
  return { rows, missed };
}

/**
 * House numbers as ranges, split by parity.
 *
 * Parity is not a tidying detail. Where a zone boundary runs *along* a street, and several of
 * Bucharest's do, the odd side is inside and the even side is out. Prelungirea Ferentari is
 * exactly that: odd 3–169 in Zone B, even 2–158 outside. Grouped without parity it needs 95
 * alternating ranges and reads like noise; split by it, two.
 *
 * A range spans two known addresses with nothing differently-zoned between them, so a number
 * that falls inside one can be answered. A number outside every range is not guessed at.
 */
function numberRanges(byNumber) {
  const run = (keep) => {
    const numbers = [...byNumber.keys()].filter(keep).sort((a, b) => a - b);
    const out = [];
    for (const n of numbers) {
      const zone = byNumber.get(n);
      const last = out[out.length - 1];
      if (last && last[2] === zone) last[1] = n;
      else out.push([n, n, zone]);
    }
    return out;
  };
  return { odd: run((n) => n % 2 === 1), even: run((n) => n % 2 === 0) };
}

/** The leading integer of a house number: "128A" → 128, "18-20" → 18, "bis" → null. */
export function houseNumberValue(value) {
  const match = String(value || '').trim().match(/^(\d{1,5})/);
  return match ? Number(match[1]) : null;
}

/**
 * Which zone each address point falls in, for the streets where the street alone cannot say.
 *
 * Only streets that cross a boundary are indexed. For the rest the street already settles it,
 * and carrying their addresses would multiply the file for no answer anybody needs.
 */
function classifyNumbers(addresses, city, crossing) {
  const perStreet = new Map();
  const zonesByPriority = [...city.zones].sort((a, b) => b.priority - a.priority);

  for (const address of addresses) {
    const key = normalizeStreetName(address.street);
    if (!crossing.has(key)) continue;
    const number = houseNumberValue(address.number);
    if (number == null) continue;

    const zone = zonesByPriority.find((z) => pointInGeometry([address.lat, address.lon], z.outline));
    if (!perStreet.has(key)) perStreet.set(key, new Map());
    const byNumber = perStreet.get(key);
    // First reading wins: duplicate points on one number are the same building.
    if (!byNumber.has(number)) byNumber.set(number, zone ? zone.code : '');
  }
  return perStreet;
}

/** The spelling OSM uses most often, so the screen shows a name a person would recognise. */
function preferredLabel(labels) {
  return [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ro'))[0][0];
}

function render(city, byStreet, numbersByStreet) {
  const order = new Map(city.zones.map((z, i) => [z.code, i]));
  // JSON.stringify rather than hand-rolled quoting: street names carry apostrophes.
  const lit = (v) => JSON.stringify(String(v));
  const side = (ranges) => `[${ranges.map(([a, b, z]) => `[${a},${b},${lit(z)}]`).join(',')}]`;
  const numberRows = [...numbersByStreet.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ro'))
    .map(([key, ranges]) => `  [${lit(key)}, ${side(ranges.odd)}, ${side(ranges.even)}],`);
  const rows = [...byStreet.values()]
    .sort((a, b) => a.key.localeCompare(b.key, 'ro'))
    .map((entry) => {
      const zones = city.zones
        .map((z) => [z.code, coverage(entry, z.code)])
        .filter(([, cover]) => cover)
        .sort((a, b) => order.get(a[0]) - order.get(b[0]))
        .map(([code, cover]) => `${code}:${cover}`);
      // Streets outside every zone are kept: knowing a street exists and is unrestricted is a
      // real answer, and telling it apart from "never heard of it" is what stops the screen
      // implying a typo when the street is simply outside the city's restricted area.
      return `  ['${entry.key.replace(/'/g, "\\'")}', '${preferredLabel(entry.labels).replace(/'/g, "\\'")}', '${zones.join(',')}'],`;
    });

  return `/**
 * Street → zone index for ${city.label}. GENERATED, do not edit by hand.
 *
 * Rebuild with:  node scripts/build-street-zones.js ${city.id}
 *
 * Each row is [normalised key, display name, zones]. A zone reads CODE:f when the whole
 * street lies inside it and CODE:p when only part of it does. An empty list means the street
 * is in the city but outside every restricted zone, which is a different answer from a street
 * nobody has heard of, the screen has to be able to tell those apart.
 *
 * Source: OpenStreetMap contributors (ODbL), classified against the outlines in
 * \`zoneReference.js\` on ${new Date().toISOString().slice(0, 10)}.
 */
export const CITY_ID = '${city.id}';

export const STREETS = [
${rows.join('\n')}
];

/**
 * House numbers for the streets a boundary runs through, where the street alone cannot
 * answer.
 *
 * [key, odd, even], each side a list of [from, to, zones] spanning known addresses with
 * nothing differently-zoned between them. Parity is kept separate because a boundary that
 * follows a street puts the odd side in and the even side out. A number outside every range
 * has no answer here, and callers must say so rather than reaching for the nearest one.
 */
export const STREET_NUMBERS = [
${numberRows.join('\n')}
];
`;
}

async function build(city, { cached, cachedAddresses, skipAddresses } = {}) {
  process.stdout.write(`${city.label}:\n`);
  const data = cached ?? await fetchStreets(city);
  const byStreet = classify(data.elements ?? [], city);
  const file = path.join(OUT_DIR, `${city.id}.js`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Only streets a boundary actually runs through get an address index: for the rest the
  // street already settles it, and their addresses would multiply the file for no answer.
  const crossing = new Set([...byStreet.entries()]
    .filter(([, entry]) => city.zones.some((z) => coverage(entry, z.code) === 'p'))
    .map(([key]) => key));

  let numbersByStreet = new Map();
  if (crossing.size && !skipAddresses) {
    process.stdout.write(`  ${crossing.size} străzi traversează o limită, caut adresele lor\n`);
    const { rows, missed } = cachedAddresses ?? await fetchAddresses(city);
    const perStreet = classifyNumbers(rows, city, crossing);
    numbersByStreet = new Map([...perStreet.entries()].map(([k, m]) => [k, numberRanges(m)]));
    if (missed?.length) {
      process.stdout.write(`  ATENȚIE: ${missed.length} zone nu au răspuns, indexul e incomplet\n`);
    }
  }

  fs.writeFileSync(file, render(city, byStreet, numbersByStreet), 'utf8');

  const counts = new Map();
  for (const entry of byStreet.values()) {
    const parts = city.zones
      .map((z) => [z.code, coverage(entry, z.code)])
      .filter(([, cover]) => cover)
      .map(([code, cover]) => `${code}:${cover}`);
    const label = parts.length ? parts.join(' ') : '(fără zonă)';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  process.stdout.write(`  ${byStreet.size} străzi din ${data.elements.length} segmente\n`);
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    ${label.padEnd(12)} ${n}\n`);
  }
  process.stdout.write(`  scris ${path.relative(path.resolve(here, '..'), file)}`
    + ` (${(fs.statSync(file).size / 1024).toFixed(0)} KB)\n`);
}

const args = process.argv.slice(2);

function flagValue(name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
}

const cachePath = flagValue('--cache');
const addressCachePath = flagValue('--addresses');
const cached = cachePath ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : null;

/**
 * A saved address pass, so a rebuild does not re-query Overpass for data that changes yearly.
 * The file is the same pipe-separated dump the fetch produces.
 */
const cachedAddresses = addressCachePath
  ? {
    rows: fs.readFileSync(addressCachePath, 'utf8').split(/\r?\n/).map((line) => {
      const parts = line.split('|');
      if (parts.length < 4) return null;
      const lat = Number(parts[2]);
      const lon = Number(parts[3]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { street: parts[0], number: parts[1], lat, lon };
    }).filter(Boolean),
    missed: [],
  }
  : null;

const skipAddresses = args.includes('--no-addresses');
const consumed = new Set([cachePath, addressCachePath].filter(Boolean));
const wanted = args.filter((a) => !a.startsWith('--') && !consumed.has(a));

const cities = wanted.length
  ? ZONE_CITIES.filter((c) => wanted.includes(c.id))
  : ZONE_CITIES;

if (!cities.length) {
  console.error(`Niciun oraș cunoscut în: ${wanted.join(', ')}`);
  process.exit(1);
}

for (const city of cities) {
  // Sequential on purpose: Overpass is a shared public service and this is a build step.
  await build(city, { cached, cachedAddresses, skipAddresses });
}
