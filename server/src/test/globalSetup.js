/**
 * Creates the test database if it is missing, then brings it up to the current schema.
 *
 * The migration is the same one production uses. A schema built any other way stops catching
 * schema bugs, which is most of what these tests exist for — a route selecting a column that
 * does not exist is invisible until something runs it against the real thing.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import pg from 'pg';
import { SERVER_ROOT, assertTestDatabase, databaseName, testDatabaseUrl } from './testEnv.js';

/** Connects to the maintenance database so the test one can be created if it is not there. */
async function ensureDatabase(url) {
  const database = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      // CREATE DATABASE takes no parameters. The name comes from our own guarded env var and is
      // quoted, so nothing can ride through it.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
  return database;
}

export default async function setup() {
  const url = testDatabaseUrl();
  const name = assertTestDatabase(url);

  await ensureDatabase(url);

  const result = spawnSync(process.execPath, [path.join(SERVER_ROOT, 'src', 'migrate.js')], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(`Migration failed for ${name}:\n${result.stdout}\n${result.stderr}`);
  }
}
