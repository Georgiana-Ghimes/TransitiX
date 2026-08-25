#!/usr/bin/env node
/**
 * Geocodes `locations` rows that have no coordinates yet.
 *
 *   npm run geocode:locations --prefix server              # dry run — reports, writes nothing
 *   npm run geocode:locations --prefix server -- --apply
 *   npm run geocode:locations --prefix server -- --apply --limit 200 --delay 200
 *   npm run geocode:locations --prefix server -- --apply --refresh   # ignore cached results
 *
 * Coordinates are written for both accept and review outcomes, but `geocode_verified` stays
 * false until a person confirms the pin. Rejected addresses keep no coordinates at all —
 * an empty map marker is honest, a wrong one is not.
 */
import dotenv from 'dotenv';
import { pool, query } from './db.js';
import {
  applyToLocation,
  emptyStats,
  geocodeAddress,
  tally,
} from './lib/geo/geocode.js';
import { photonConfigured } from './lib/geo/photon.js';

dotenv.config();

function parseArgs(argv) {
  const args = { apply: false, company: null, limit: 500, delay: 150, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--company') args.company = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]) || 500;
    else if (arg === '--delay') args.delay = Number(argv[++i]) || 0;
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function label(action) {
  if (action === 'accept') return 'ACCEPT';
  if (action === 'review') return 'REVIEW';
  return 'RESPINS';
}

async function loadCompanies(companyId) {
  const sql = companyId
    ? 'SELECT id, name FROM companies WHERE id = $1'
    : 'SELECT id, name FROM companies ORDER BY created_at';
  const result = await query(sql, companyId ? [companyId] : []);
  return result.rows;
}

async function processCompany(company, args) {
  const pending = await query(
    `SELECT id, name, address, city, county, address_key
     FROM locations
     WHERE company_id = $1 AND (latitude IS NULL OR longitude IS NULL)
     ORDER BY created_at
     LIMIT $2`,
    [company.id, args.limit]
  );

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${company.name} — ${pending.rowCount} locații fără coordonate`);
  console.log('='.repeat(64));

  if (!pending.rowCount) return emptyStats();

  const stats = emptyStats();
  for (const location of pending.rows) {
    // The stored address lost its city during backfill (it lives in its own column),
    // so recombine before querying the geocoder.
    const full = [location.address, location.city, location.county].filter(Boolean).join(', ');
    const result = await geocodeAddress(pool, company.id, full, { refresh: args.refresh });
    tally(stats, result);

    const conf = result.best ? result.best.confidence.toFixed(2) : '—';
    const cached = result.cached ? ' (cache)' : '';
    console.log(`  ${label(result.outcome.action).padEnd(8)} ${conf.padStart(5)}  ${location.name}`);
    console.log(`           ${full}`);
    if (result.best?.label) console.log(`        →  ${result.best.label}`);
    if (result.error) console.log(`        !  ${result.error}`);
    if (result.outcome.action === 'reject' && !result.error) {
      console.log(`        !  ${result.outcome.reason} — necesită pin manual`);
    }

    if (args.apply) await applyToLocation(pool, company.id, location.id, result);
    if (!result.cached && args.delay) await sleep(args.delay);
    if (cached) { /* cached rows cost nothing, no delay needed */ }
  }

  console.log(`\n  Rezultat: ${stats.accepted} acceptate · ${stats.review} de verificat · ${stats.rejected} respinse`);
  console.log(`            ${stats.cached} din cache · ${stats.errors} erori`);
  if (!args.apply) console.log('\n  DRY RUN — nicio coordonată scrisă. Adaugă --apply.');
  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!photonConfigured()) {
    console.error('\n  PHOTON_URL nu este setat în server/.env — geocodarea nu poate rula.');
    console.error('  Self-host Photon, sau pentru development pune https://photon.komoot.io');
    console.error('  (instanță publică, rate-limited, fără date reale de clienți).\n');
    process.exitCode = 1;
    return;
  }

  const companies = await loadCompanies(args.company);
  if (!companies.length) {
    console.error('Nicio companie găsită.');
    process.exitCode = 1;
    return;
  }

  const totals = emptyStats();
  for (const company of companies) {
    const stats = await processCompany(company, args);
    for (const key of Object.keys(totals)) totals[key] += stats[key];
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  Total: ${totals.total} adrese — ${totals.accepted} acceptate, ` +
              `${totals.review} de verificat, ${totals.rejected} respinse`);
  if (args.apply && (totals.review || totals.rejected)) {
    console.log(`  ${totals.review + totals.rejected} locații au nevoie de confirmare pe hartă.`);
  }
  console.log('='.repeat(64) + '\n');
}

main()
  .catch((err) => {
    console.error('Geocodare eșuată:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
