/**
 * Versioned migrations, on top of the schema that already exists.
 *
 * `migrate.js` was one 1400-line SQL template that ran in full every time. It worked because
 * every statement in it is idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` —
 * but it could not answer three questions: what has this database had applied, what is missing,
 * and how do I undo the last thing. And the idempotence is a convention nothing enforces: the
 * first `ALTER TABLE ... DROP COLUMN` somebody writes runs on every deploy forever.
 *
 * The compromise here is deliberate. Rewriting that file into fifty numbered steps would be a
 * large change that alters nothing about the resulting schema, and the risk lives entirely in the
 * rewrite. So the monolith stays as the **baseline**, recorded as applied once, and everything
 * from now on is a numbered file that runs exactly once and can be rolled back.
 */
import fs from 'fs';
import path from 'path';

/** Numbered files, sorted by their number rather than by string order. */
const FILE_SHAPE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export const BASELINE_ID = '0000_baseline';

export const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How long it took, so a slow one is visible before it is a production incident.
  duration_ms INT,
  -- The rollback for this step, stored with it. A .down.sql sitting in the repo describes what
  -- the file says today; this describes what actually ran.
  down_sql TEXT
);
`;

/**
 * Reads the migration directory.
 *
 * A file that does not match the naming shape is an error rather than something skipped: a
 * migration silently ignored because of a typo in its name is the worst possible outcome here.
 */
export function readMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));

  const migrations = entries.map((file) => {
    const match = FILE_SHAPE.exec(file);
    if (!match) {
      throw new Error(
        `Migration "${file}" nu respectă formatul NNNN_nume_cu_underscore.sql. `
        + 'Un fișier ignorat din cauza numelui e cel mai prost rezultat posibil.'
      );
    }
    const [, number, name] = match;
    const downFile = path.join(dir, file.replace(/\.sql$/, '.down.sql'));
    return {
      id: `${number}_${name}`,
      number: Number(number),
      file,
      up: fs.readFileSync(path.join(dir, file), 'utf8'),
      down: fs.existsSync(downFile) ? fs.readFileSync(downFile, 'utf8') : null,
    };
  }).sort((a, b) => a.number - b.number);

  const seen = new Map();
  for (const migration of migrations) {
    if (seen.has(migration.number)) {
      throw new Error(
        `Două migrări au numărul ${migration.number}: ${seen.get(migration.number)} și ${migration.file}. `
        + 'Ordinea ar depinde de sistemul de fișiere.'
      );
    }
    seen.set(migration.number, migration.file);
  }
  return migrations;
}

/** What has run, oldest first. */
export async function appliedIds(client) {
  const res = await client.query('SELECT id FROM schema_migrations ORDER BY id');
  return res.rows.map((r) => r.id);
}

export function pendingMigrations(all, applied) {
  const done = new Set(applied);
  return all.filter((m) => !done.has(m.id));
}

/**
 * Migrations recorded as applied that no longer exist in the repo.
 *
 * Usually a branch switch. Reported rather than acted on: deleting the record would lose the
 * rollback stored with it, and running anything would be a guess about which side is right.
 */
export function orphanedIds(all, applied) {
  const known = new Set([BASELINE_ID, ...all.map((m) => m.id)]);
  return applied.filter((id) => !known.has(id));
}

/**
 * Applies one migration inside its own transaction.
 *
 * Per migration rather than one transaction for all of them: a failure halfway through five steps
 * should leave the four that succeeded recorded, not silently rolled back into a state the log
 * disagrees with. Postgres runs DDL transactionally, so a failed step leaves nothing behind.
 */
export async function applyOne(client, migration) {
  const started = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(migration.up);
    await client.query(
      `INSERT INTO schema_migrations (id, duration_ms, down_sql) VALUES ($1, $2, $3)`,
      [migration.id, Date.now() - started, migration.down]
    );
    await client.query('COMMIT');
    return { id: migration.id, duration_ms: Date.now() - started };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    err.migrationId = migration.id;
    throw err;
  }
}

/**
 * Undoes the most recently applied migration, using the rollback stored when it ran.
 *
 * Refuses when there is none. A migration without a `.down.sql` is a decision — some changes
 * genuinely cannot be undone — and inventing one here would be a guess at what the author meant.
 */
export async function rollbackLast(client) {
  const last = await client.query(
    `SELECT id, down_sql FROM schema_migrations
     WHERE id <> $1 ORDER BY id DESC LIMIT 1`,
    [BASELINE_ID]
  );
  const row = last.rows[0];
  if (!row) return { rolled_back: null, reason: 'Nu există migrări de anulat.' };
  if (!row.down_sql) {
    return {
      rolled_back: null,
      reason: `Migrarea ${row.id} nu are rollback (lipsește ${row.id}.down.sql). `
        + 'Unele schimbări nu se pot anula; scrie pașii manual.',
    };
  }

  await client.query('BEGIN');
  try {
    await client.query(row.down_sql);
    await client.query('DELETE FROM schema_migrations WHERE id = $1', [row.id]);
    await client.query('COMMIT');
    return { rolled_back: row.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    err.migrationId = row.id;
    throw err;
  }
}

/** What `migrate:status` prints: everything known, and whether it has run. */
export function statusRows(all, applied) {
  const done = new Set(applied);
  return [
    { id: BASELINE_ID, applied: done.has(BASELINE_ID), baseline: true },
    ...all.map((m) => ({ id: m.id, applied: done.has(m.id), reversible: Boolean(m.down) })),
  ];
}
