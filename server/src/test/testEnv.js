/**
 * Where the route tests get their database URL.
 *
 * Shared by the vitest config and by `globalSetup`, which run in different processes — vitest's
 * `test.env` reaches the test workers but not the setup file, so both have to derive the value
 * the same way or the guard and the tests would disagree about which database is in play.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..', '..');

/** Minimal .env reader — no dotenv, so this can be used before any dependency is loaded. */
export function readEnvFile(file = path.join(SERVER_ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function testDatabaseUrl() {
  const fileEnv = readEnvFile();
  return process.env.TEST_DATABASE_URL
    || fileEnv.TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || fileEnv.DATABASE_URL
    || '';
}

export function databaseName(url) {
  return String(url || '').split('/').pop()?.split('?')[0] ?? '';
}

/**
 * The suite deletes rows. A database whose name does not say "disposable" is not one we touch —
 * pointed at a development database this would destroy real work, and there is no undo.
 */
export function assertTestDatabase(url) {
  const name = databaseName(url);
  if (!/_test$/.test(name)) {
    throw new Error(
      `Route tests refuse to run against "${name || '(unset)'}".\n`
      + 'Set TEST_DATABASE_URL in server/.env to a database whose name ends in _test, e.g.\n'
      + '  TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/transitix_test'
    );
  }
  return name;
}
