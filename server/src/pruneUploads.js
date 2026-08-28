/**
 * Reclaims disk in `uploads/` — orphans only.
 *
 * What this deletes: files no database row points at. They come from uploads abandoned before a
 * row was written (`/api/integrations/upload` hands back a URL the client may never use), and
 * from rows deleted later.
 *
 * What this never deletes: a file a row still references, whatever its age. Those are the avize,
 * CMRs and weighbridge tickets behind every export ever sent — `aviz_export_log.snapshot` can
 * reproduce the numbers on a sheet, but only the file shows the customer where they came from.
 * Ageing those out is an accounting decision with a statutory retention period behind it, not a
 * disk-space one, so it is deliberately not implemented here.
 *
 *   npm run prune:uploads --prefix server                    # lists, deletes nothing
 *   npm run prune:uploads --prefix server -- --delete
 *   npm run prune:uploads --prefix server -- --min-age-days 30 --delete
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadRoot } from './uploadPath.js';

/**
 * Every column that can hold a path into `uploads/`.
 *
 * A column missing from this list makes its files look orphaned, and the script would delete
 * documents somebody still needs. That is why a missing column aborts the run instead of being
 * skipped: schema drift must not become silent data loss.
 */
const FILE_COLUMNS = [
  ['companies', 'logo_url'],
  ['trip_documents', 'original_image_url'],
  ['trip_documents', 'final_pdf_url'],
  ['client_confirmations', 'damage_image_url'],
  ['aviz_documents', 'file_url'],
  ['delivery_proofs', 'signature_url'],
  ['tachograph_imports', 'file_url'],
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Only the filename matters: rows store `/uploads/x.jpg`, disk has `x.jpg`. */
export function basenameOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const name = path.basename(raw.split('?')[0]);
  return name && name !== '.' && name !== '..' ? name : null;
}

/**
 * Which files may go, given what is on disk and what the database still points at.
 *
 * Kept separate from the filesystem and the database so the decision can be tested without
 * either — deleting the wrong file here is not recoverable.
 */
export function planPrune(files, referenced, { now = Date.now(), minAgeMs = 0 } = {}) {
  const orphans = [];
  let keptReferenced = 0;
  let keptYoung = 0;

  for (const file of files) {
    if (referenced.has(file.name)) { keptReferenced += 1; continue; }
    // A file uploaded moments ago may be waiting for the row that will reference it.
    if (now - file.mtimeMs < minAgeMs) { keptYoung += 1; continue; }
    orphans.push(file);
  }

  return { orphans, keptReferenced, keptYoung, bytes: orphans.reduce((s, o) => s + o.size, 0) };
}

async function main() {
  // Imported lazily so the unit suite, which imports this file for `planPrune`, never pulls in a
  // database driver — `npm test` has to run on a clean checkout with nothing started.
  const { pool } = await import('./db.js');

  if (!fs.existsSync(uploadRoot)) {
    console.log(`[prune] ${uploadRoot} does not exist — nothing to do.`);
    return;
  }

  const minAgeDays = Number(arg('min-age-days', '7'));
  if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
    throw new Error('--min-age-days must be a non-negative number.');
  }
  const doDelete = process.argv.includes('--delete');

  // Verify the schema first: a renamed column would come back as "nothing references files".
  const present = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const have = new Set(present.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const missing = FILE_COLUMNS.map(([t, c]) => `${t}.${c}`).filter((k) => !have.has(k));
  if (missing.length) {
    throw new Error(
      `schema changed — ${missing.join(', ')} no longer exist. `
      + 'Refusing to run: files they referenced would look orphaned.'
    );
  }

  const referenced = new Set();
  for (const [table, column] of FILE_COLUMNS) {
    const rows = await pool.query(
      `SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`
    );
    for (const row of rows.rows) {
      const name = basenameOf(row.value);
      if (name) referenced.add(name);
    }
  }

  const files = fs.readdirSync(uploadRoot, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const stat = fs.statSync(path.join(uploadRoot, e.name));
      return { name: e.name, size: stat.size, mtimeMs: stat.mtimeMs, mtime: stat.mtime };
    });

  // The catastrophic case: a migrated but empty database — a fresh one, or the wrong URL. Every
  // file on disk would look orphaned. A tenant with no documents *yet* is a different thing and
  // a legitimate prune, so the test is whether the database holds a company at all.
  const tenants = (await pool.query('SELECT COUNT(*)::int AS n FROM companies')).rows[0].n;
  if (tenants === 0 && files.length > 0) {
    throw new Error(
      `the database holds no company, but ${files.length} files are on disk. `
      + 'That usually means the wrong DATABASE_URL. Nothing was deleted.'
    );
  }
  if (referenced.size === 0 && files.length > 0) {
    console.warn('[prune] Warning: no row references any file. Read the list below before deleting.');
  }

  const plan = planPrune(files, referenced, { minAgeMs: minAgeDays * 24 * 60 * 60 * 1000 });

  console.log(`[prune] ${uploadRoot}`);
  console.log(`[prune]   ${files.length} files, ${referenced.size} referenced by the database`);
  console.log(`[prune]   kept: ${plan.keptReferenced} referenced, ${plan.keptYoung} newer than ${minAgeDays} day(s)`);
  console.log(`[prune]   orphans: ${plan.orphans.length} (${mb(plan.bytes)})`);
  for (const o of plan.orphans.slice(0, 20)) {
    console.log(`[prune]     ${o.mtime.toISOString().slice(0, 10)}  ${mb(o.size).padStart(8)}  ${o.name}`);
  }
  if (plan.orphans.length > 20) console.log(`[prune]     … and ${plan.orphans.length - 20} more`);

  if (!doDelete) {
    console.log('[prune] Dry run — nothing was deleted. Pass --delete to remove them.');
    return;
  }

  let removed = 0;
  for (const o of plan.orphans) {
    try {
      fs.unlinkSync(path.join(uploadRoot, o.name));
      removed += 1;
    } catch (err) {
      console.error(`[prune] could not remove ${o.name}: ${err.message}`);
    }
  }
  console.log(`[prune] Removed ${removed} file(s), ${mb(plan.bytes)} reclaimed.`);
}

// Only when run as a script. Importing this file must not start anything — its test does.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error('[prune] failed:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { pool } = await import('./db.js');
      await pool.end();
    });
}
