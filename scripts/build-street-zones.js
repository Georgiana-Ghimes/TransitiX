/**
 * Builds the street → zone index the map searches, so no address ever leaves the server.
 *
 * The alternative was a geocoder, which means sending whatever an operator types — often a
 * customer's delivery address — to a third party on every lookup. For this question we do not
 * need one: the zones are fixed polygons and a city has a few thousand street names, so which
 * zones a street touches can be decided once, here, and shipped as data.
 *
 * It is also the more honest answer. A geocoder returns one pin for a street that may run for
 * kilometres, and several of Bucharest's zone boundaries *follow* a street — so that pin lands
 * on one side or the other with confidence it has not earned. This records every zone a street
 * lies in each zone, so the screen can say "crosses the boundary, the house number decides"
 * instead of guessing.
 *
 * Usage:
 *   node scripts/build-street-zones.js                 # all cities in the reference
 *   node scripts/build-street-zones.js bucuresti       # one city
 *   node scripts/build-street-zones.js --cache <file>  # reuse a saved Overpass response
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

/** The spelling OSM uses most often, so the screen shows a name a person would recognise. */
function preferredLabel(labels) {
  return [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ro'))[0][0];
}

function render(city, byStreet) {
  const order = new Map(city.zones.map((z, i) => [z.code, i]));
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
 * Street → zone index for ${city.label}. GENERATED — do not edit by hand.
 *
 * Rebuild with:  node scripts/build-street-zones.js ${city.id}
 *
 * Each row is [normalised key, display name, zones]. A zone reads CODE:f when the whole
 * street lies inside it and CODE:p when only part of it does. An empty list means the street
 * is in the city but outside every restricted zone, which is a different answer from a street
 * nobody has heard of — the screen has to be able to tell those apart.
 *
 * Source: OpenStreetMap contributors (ODbL), classified against the outlines in
 * \`zoneReference.js\` on ${new Date().toISOString().slice(0, 10)}.
 */
export const CITY_ID = '${city.id}';

export const STREETS = [
${rows.join('\n')}
];
`;
}

async function build(city, cached) {
  process.stdout.write(`${city.label}:\n`);
  const data = cached ?? await fetchStreets(city);
  const byStreet = classify(data.elements ?? [], city);
  const file = path.join(OUT_DIR, `${city.id}.js`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, render(city, byStreet), 'utf8');

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
const cacheAt = args.indexOf('--cache');
const cached = cacheAt >= 0 ? JSON.parse(fs.readFileSync(args[cacheAt + 1], 'utf8')) : null;
const wanted = args.filter((a, i) => !a.startsWith('--') && i !== cacheAt + 1);

const cities = wanted.length
  ? ZONE_CITIES.filter((c) => wanted.includes(c.id))
  : ZONE_CITIES;

if (!cities.length) {
  console.error(`Niciun oraș cunoscut în: ${wanted.join(', ')}`);
  process.exit(1);
}

for (const city of cities) {
  // Sequential on purpose: Overpass is a shared public service and this is a build step.
  await build(city, cached);
}
