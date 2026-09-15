/**
 * Backup for the documents companion: the database and the uploaded files, together.
 *
 * Both halves are needed and neither is enough on its own. `aviz_export_log.snapshot` can
 * reproduce an annex that was already sent, but the scanned document behind a figure lives only
 * in `uploads/`, losing that directory loses the evidence for every export ever made.
 *
 *   node scripts/backup-companion.js [--out DIR] [--keep N]
 *
 * Reads DATABASE_URL and UPLOAD_DIR from server/.env unless they are already in the environment.
 * Needs `pg_dump` on PATH. When Postgres runs in the companion compose stack instead, use:
 *   docker compose -f docker-compose.companion.yml exec -T db pg_dump -U postgres transitix_rai > db.sql
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ROOT = path.join(ROOT, 'server');

/** Minimal .env reader, the same shape server/src/test/testEnv.js uses. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The database name out of a connection URL, for the container fallback. */
function databaseName(url) {
  return String(url || '').split('/').pop()?.split('?')[0] ?? '';
}

/**
 * Writes the dump, from the host or from inside the compose stack.
 *
 * The VM runs Postgres in a container and nothing else, so `pg_dump` is usually absent from the
 * host PATH. Telling somebody to go and read a comment at that point is telling them to skip the
 * backup, which is the one step of a deploy that cannot be redone afterwards.
 *
 * The container's own `pg_dump` is also the right version for the server it is dumping, which
 * the host's may not be.
 */
function dumpDatabase(databaseUrl, dumpPath) {
  const direct = spawnSync('pg_dump', ['--no-owner', '--no-acl', '--file', dumpPath, databaseUrl], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (!direct.error && direct.status === 0) return true;
  if (direct.error && direct.error.code !== 'ENOENT') {
    console.error(`pg_dump failed: ${direct.error.message}`);
    return false;
  }
  if (!direct.error) {
    console.error(`pg_dump exited with ${direct.status}. Nothing was kept.`);
    return false;
  }

  const db = databaseName(databaseUrl);
  const compose = path.join(ROOT, 'docker-compose.companion.yml');
  if (!db || !fs.existsSync(compose)) {
    console.error('pg_dump not found on PATH, and no companion compose stack to fall back on.');
    return false;
  }

  console.warn('[backup] pg_dump not on PATH, dumping from the companion container instead.');
  const out = fs.openSync(dumpPath, 'w');
  try {
    const viaDocker = spawnSync(
      'docker',
      ['compose', '-f', compose, 'exec', '-T', 'db',
        'pg_dump', '--no-owner', '--no-acl', '-U', process.env.POSTGRES_USER || 'postgres', db],
      { stdio: ['ignore', out, 'inherit'] },
    );
    if (viaDocker.error?.code === 'ENOENT') {
      console.error('Neither pg_dump nor docker is available. Cannot back up.');
      return false;
    }
    if (viaDocker.status !== 0) {
      console.error(`docker compose pg_dump exited with ${viaDocker.status}. Nothing was kept.`);
      return false;
    }
  } finally {
    fs.closeSync(out);
  }
  // An empty dump is a failure that exited zero. Better caught here than on a restore.
  if (fs.statSync(dumpPath).size === 0) {
    console.error('The dump came back empty. Nothing was kept.');
    return false;
  }
  return true;
}

function main() {
  const fileEnv = readEnvFile(path.join(SERVER_ROOT, '.env'));
  const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || '';
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set (env or server/.env).');
    process.exit(1);
  }

  // UPLOAD_DIR is relative to server/, that is the cwd the API runs with.
  const rawUploads = process.env.UPLOAD_DIR || fileEnv.UPLOAD_DIR || 'uploads';
  const uploadDir = path.isAbsolute(rawUploads) ? rawUploads : path.join(SERVER_ROOT, rawUploads);

  const outRoot = path.resolve(arg('out', path.join(ROOT, 'backups')));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(outRoot, stamp);
  fs.mkdirSync(target, { recursive: true });

  const dumpPath = path.join(target, 'db.sql');
  if (!dumpDatabase(databaseUrl, dumpPath)) {
    fs.rmSync(target, { recursive: true, force: true });
    process.exit(1);
  }

  let uploadBytes = 0;
  if (fs.existsSync(uploadDir)) {
    fs.cpSync(uploadDir, path.join(target, 'uploads'), { recursive: true });
    uploadBytes = dirSize(path.join(target, 'uploads'));
  } else {
    console.warn(`[backup] ${uploadDir} does not exist, database only.`);
  }

  console.log(`[backup] ${target}`);
  console.log(`[backup]   db.sql   ${mb(fs.statSync(dumpPath).size)}`);
  console.log(`[backup]   uploads  ${mb(uploadBytes)}`);

  const keep = Number(arg('keep', '0'));
  if (keep > 0) {
    const kept = fs.readdirSync(outRoot)
      .filter((name) => fs.statSync(path.join(outRoot, name)).isDirectory())
      .sort()
      .reverse();
    for (const old of kept.slice(keep)) {
      fs.rmSync(path.join(outRoot, old), { recursive: true, force: true });
      console.log(`[backup]   pruned ${old}`);
    }
  }
}

main();
