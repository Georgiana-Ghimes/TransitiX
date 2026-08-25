#!/usr/bin/env node
/**
 * Backfills `locations` from the addresses already held on `clients` and `trips`.
 *
 *   npm run backfill:locations --prefix server              # dry run — reports, writes nothing
 *   npm run backfill:locations --prefix server -- --apply   # writes the rows
 *   npm run backfill:locations --prefix server -- --apply --company <uuid>
 *
 * Dry run is the default on purpose: the report tells you how geocodable the existing data
 * is before anything is inserted, which is the question P0 exists to answer.
 *
 * Idempotent — the unique index on (company_id, address_key) plus ON CONFLICT DO NOTHING
 * means re-running only ever adds addresses that appeared since the last run.
 */
import dotenv from 'dotenv';
import { pool, query, withTransaction } from './db.js';
import {
  assessCandidates,
  candidatesFromClients,
  candidatesFromTrips,
  dedupeCandidates,
  indexClients,
  summarize,
  toLocationRow,
} from './lib/geo/backfill.js';

dotenv.config();

const LOCATION_COLUMNS = [
  'company_id', 'client_id', 'name', 'kind', 'address', 'city', 'county', 'postcode',
  'country', 'address_key', 'contact_person', 'phone', 'geocode_source', 'geocode_verified',
];

function parseArgs(argv) {
  const args = { apply: false, company: null, limitExamples: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--company') args.company = argv[++i];
    else if (arg.startsWith('--company=')) args.company = arg.slice(10);
    else if (arg === '--examples') args.limitExamples = Number(argv[++i]) || 10;
  }
  return args;
}

function pct(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function printReport(companyName, report, examples) {
  const { candidates, unique, merged, skippedExisting, unusable, byTier, byFlag, bySource, byCounty } = report;

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${companyName}`);
  console.log('='.repeat(64));

  if (!candidates) {
    console.log('  Nicio adresă de procesat.');
    return;
  }

  console.log(`\n  Adrese găsite       ${candidates}`);
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${source.padEnd(16)} ${count}`);
  }

  console.log(`\n  Locații unice       ${unique}`);
  console.log(`    duplicate unite   ${merged}`);
  console.log(`    deja existente    ${skippedExisting}`);
  console.log(`    inutilizabile     ${unusable}`);

  console.log(`\n  Calitate (scor mediu ${report.averageScore})`);
  console.log(`    geocodabile       ${byTier.good || 0}  (${pct(byTier.good || 0, candidates)})  → merg direct la geocoder`);
  console.log(`    de verificat      ${byTier.review || 0}  (${pct(byTier.review || 0, candidates)})  → geocoder + confirmare pe hartă`);
  console.log(`    slabe             ${byTier.poor || 0}  (${pct(byTier.poor || 0, candidates)})  → pin manual, aproape sigur`);

  const flags = Object.entries(byFlag).sort((a, b) => b[1] - a[1]);
  if (flags.length) {
    console.log('\n  Ce lipsește');
    for (const [flag, count] of flags) {
      console.log(`    ${flag.padEnd(18)} ${String(count).padStart(4)}  (${pct(count, candidates)})`);
    }
  }

  const counties = Object.entries(byCounty).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (counties.length) {
    console.log('\n  Județe');
    console.log(`    ${counties.map(([code, count]) => `${code}:${count}`).join('  ')}`);
  }

  if (examples.length) {
    console.log('\n  Exemple care au nevoie de intervenție manuală');
    for (const row of examples) {
      console.log(`    [${row.score.toFixed(2)}] ${row.address}`);
      console.log(`           → ${row.flags.join(', ') || 'fără probleme'}`);
    }
  }
}

async function loadCompanies(companyId) {
  const sql = companyId
    ? 'SELECT id, name FROM companies WHERE id = $1'
    : 'SELECT id, name FROM companies ORDER BY created_at';
  const result = await query(sql, companyId ? [companyId] : []);
  return result.rows;
}

async function insertRows(companyId, rows) {
  if (!rows.length) return 0;
  return withTransaction(async (client) => {
    let inserted = 0;
    for (const candidate of rows) {
      const row = toLocationRow(candidate, companyId);
      const values = LOCATION_COLUMNS.map((col) => row[col] ?? null);
      const placeholders = LOCATION_COLUMNS.map((_, idx) => `$${idx + 1}`);
      const result = await client.query(
        `INSERT INTO locations (${LOCATION_COLUMNS.join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (company_id, address_key) WHERE address_key IS NOT NULL DO NOTHING
         RETURNING id`,
        values
      );
      inserted += result.rowCount;
    }
    return inserted;
  });
}

async function processCompany(company, { apply, limitExamples }) {
  const [clientsResult, tripsResult, existingResult] = await Promise.all([
    query(
      `SELECT id, name, cui, address, contact_person, phone
       FROM clients WHERE company_id = $1`,
      [company.id]
    ),
    query(
      `SELECT id, shipper_name, shipper_address, shipper_cui, shipper_contact, shipper_phone,
              consignee_name, consignee_address, consignee_cui, consignee_contact, consignee_phone
       FROM trips WHERE company_id = $1`,
      [company.id]
    ),
    query(
      `SELECT address_key FROM locations WHERE company_id = $1 AND address_key IS NOT NULL`,
      [company.id]
    ),
  ]);

  const clients = clientsResult.rows;
  const clientIndex = indexClients(clients);
  const existingKeys = new Set(existingResult.rows.map((r) => r.address_key));

  const assessed = assessCandidates([
    ...candidatesFromClients(clients),
    ...candidatesFromTrips(tripsResult.rows, clientIndex),
  ]);
  const dedupe = dedupeCandidates(assessed, { existingKeys });
  const report = summarize(assessed, dedupe);

  const examples = [...dedupe.rows]
    .filter((row) => row.tier !== 'good')
    .sort((a, b) => a.score - b.score)
    .slice(0, limitExamples);

  printReport(company.name, report, examples);

  if (!report.candidates) return { inserted: 0, unique: 0 };

  if (!apply) {
    console.log(`\n  DRY RUN — nimic scris. Adaugă --apply pentru a insera ${dedupe.rows.length} locații.`);
    return { inserted: 0, unique: dedupe.rows.length };
  }

  const inserted = await insertRows(company.id, dedupe.rows);
  console.log(`\n  Inserate ${inserted} locații (din ${dedupe.rows.length} candidate unice).`);
  return { inserted, unique: dedupe.rows.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const companies = await loadCompanies(args.company);

  if (!companies.length) {
    console.error(args.company ? `Compania ${args.company} nu există.` : 'Nicio companie în baza de date.');
    process.exitCode = 1;
    return;
  }

  let totalInserted = 0;
  let totalUnique = 0;
  for (const company of companies) {
    const result = await processCompany(company, args);
    totalInserted += result.inserted;
    totalUnique += result.unique;
  }

  console.log(`\n${'='.repeat(64)}`);
  if (args.apply) {
    console.log(`  Total inserat: ${totalInserted} locații în ${companies.length} companie(i).`);
    console.log('  Următorul pas: geocodarea locațiilor fără coordonate.');
  } else {
    console.log(`  Total de inserat: ${totalUnique} locații în ${companies.length} companie(i).`);
    console.log('  Rulează din nou cu --apply pentru a scrie.');
  }
  console.log('='.repeat(64) + '\n');
}

main()
  .catch((err) => {
    console.error('Backfill eșuat:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
