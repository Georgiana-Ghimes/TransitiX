#!/usr/bin/env node
/**
 * Builds the OSRM routing graph used by docker-compose.osrm.yml.
 *
 *   npm run osrm:prepare                 # Romania, car profile
 *   npm run osrm:prepare -- --region europe/romania
 *   npm run osrm:prepare -- --profile /opt/foot.lua
 *
 * Downloads a Geofabrik extract into docker/osrm/, then runs the three OSRM
 * build stages in the official container. Safe to re-run: the download is
 * skipped when the .osm.pbf is already there, and --force rebuilds the graph.
 *
 * Truck restrictions (height, tonnage, ADR) need Valhalla instead — that lands
 * with the optimizer in P2. The car profile is what P0 measures distances with.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const OSRM_IMAGE = 'ghcr.io/project-osrm/osrm-backend:v5.27.1';
const GEOFABRIK = 'https://download.geofabrik.de';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(repoRoot, 'docker', 'osrm');

function parseArgs(argv) {
  const args = { region: 'europe/romania', profile: '/opt/car.lua', force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--region') args.region = argv[++i];
    else if (arg === '--profile') args.profile = argv[++i];
    else if (arg.startsWith('--region=')) args.region = arg.slice(9);
    else if (arg.startsWith('--profile=')) args.profile = arg.slice(10);
  }
  return args;
}

function fail(message, hint) {
  console.error(`\n  ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
}

function requireDocker() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (probe.error || probe.status !== 0) {
    fail(
      'Docker nu răspunde.',
      'Instalează Docker Desktop și pornește-l, apoi rulează din nou scriptul.'
    );
  }
  console.log(`Docker ${probe.stdout.trim()} disponibil.`);
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function download(url, target) {
  console.log(`Descarc ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    fail(`Descărcarea a eșuat (HTTP ${res.status}).`, `Verifică numele regiunii: ${url}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastLogged = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (received - lastLogged < 25 * 1024 * 1024) return;
    lastLogged = received;
    const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : '';
    console.log(`  ${formatMB(received)}${pct}`);
  });

  const partial = `${target}.part`;
  await pipeline(body, fs.createWriteStream(partial));
  fs.renameSync(partial, target);
  console.log(`Salvat ${path.basename(target)} — ${formatMB(fs.statSync(target).size)}`);
}

function runOsrm(step, args) {
  console.log(`\n[${step}] pornit — poate dura câteva minute`);
  const result = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${dataDir}:/data`, OSRM_IMAGE, step, ...args],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  );
  if (result.status !== 0) fail(`${step} a eșuat (cod ${result.status}).`);
  console.log(`[${step}] gata`);
}

async function main() {
  const { region, profile, force } = parseArgs(process.argv.slice(2));
  const extract = region.split('/').pop();
  const pbfName = `${extract}-latest.osm.pbf`;
  const pbfPath = path.join(dataDir, pbfName);
  const graphPath = path.join(dataDir, `${extract}-latest.osrm.mldgr`);

  requireDocker();
  fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(graphPath) && !force) {
    console.log(`\nGraful pentru "${extract}" există deja. Adaugă --force pentru a-l reconstrui.`);
    printNextSteps(extract);
    return;
  }

  if (fs.existsSync(pbfPath)) {
    console.log(`${pbfName} există deja (${formatMB(fs.statSync(pbfPath).size)}) — sar peste descărcare.`);
  } else {
    await download(`${GEOFABRIK}/${region}-latest.osm.pbf`, pbfPath);
  }

  // extract reads the raw OSM data; partition + customize build the MLD index osrm-routed serves.
  runOsrm('osrm-extract', ['-p', profile, `/data/${pbfName}`]);
  runOsrm('osrm-partition', [`/data/${extract}-latest.osrm`]);
  runOsrm('osrm-customize', [`/data/${extract}-latest.osrm`]);

  printNextSteps(extract);
}

function printNextSteps(extract) {
  const composeUp = [
    'docker compose -f docker-compose.yml -f docker-compose.dev.yml',
    '-f docker-compose.osrm.yml up -d db osrm',
  ].join(' ');
  console.log(`
Gata. Pornește serviciul cu:

  ${extract === 'romania' ? '' : `OSRM_EXTRACT=${extract}-latest `}${composeUp}

Apoi adaugă în server/.env:

  OSRM_URL=http://localhost:5000

Verifică: GET http://127.0.0.1:3001/api/geo/health
`);
}

main().catch((err) => fail(err.message || String(err)));
