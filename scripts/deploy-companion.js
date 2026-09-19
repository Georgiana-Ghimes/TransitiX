/**
 * One command for a companion deploy, in the order that cannot be got wrong by hand.
 *
 *   backup  ->  migrate  ->  build  ->  (restart)
 *
 * The order is the whole point. Migrations do not run when the API boots, so restarting first
 * puts new code on an old schema: every write touching a column that does not exist yet answers
 * 500, in production, with no clue on the screen as to why. And a backup taken after a migration
 * is a backup of the thing you might need to undo.
 *
 * Every step stops the chain. A failed migration must not be followed by a build that makes the
 * broken state look deployed.
 *
 *   node scripts/deploy-companion.js [options]
 *     --expect-db NAME   refuse to run unless DATABASE_URL points at this database
 *     --skip-backup      when one was taken already, by hand, a moment ago
 *     --skip-build       server-only change
 *     --restart CMD      run CMD once the build is in place (pm2 restart rai, systemctl …)
 *     --dry-run          print the plan and the target database, change nothing
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ROOT = path.join(ROOT, 'server');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};

/** Minimal .env reader, the same shape the other scripts use. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const databaseName = (url) => String(url || '').split('/').pop()?.split('?')[0] ?? '';
const maskUrl = (url) => String(url || '').replace(/:[^:@/]*@/, ':***@');

/**
 * Runs one step, and stops the deploy if it does not succeed.
 *
 * Two shapes, because Windows and Node disagree about how to start a program. Node refuses to
 * spawn a `.cmd` without a shell, and deprecates passing an argv alongside one — the parts get
 * concatenated rather than escaped. So a shell step is handed a single command line and no argv;
 * everything else is spawned directly, with its arguments kept apart from the words in them.
 */
function run(label, { command, args = [], line = null, options = {} }) {
  process.stdout.write(`\n[deploy] ${label}\n`);
  const settings = { cwd: ROOT, stdio: 'inherit', ...options };
  const result = line
    ? spawnSync(line, { ...settings, shell: true })
    : spawnSync(command, args, settings);

  if (result.error?.code === 'ENOENT') {
    console.error(`[deploy] ${line || command} nu există pe PATH. Oprit la „${label}”.`);
    process.exit(1);
  }
  if (result.error) {
    console.error(`[deploy] „${label}” nu a putut porni: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    // A step killed by a signal reports a null status; saying "cod null" would read as a bug.
    const how = result.status === null
      ? `oprit de semnalul ${result.signal}`
      : `cod ${result.status}`;
    console.error(`[deploy] „${label}” a eșuat (${how}). Nu merg mai departe.`);
    process.exit(1);
  }
}

/** An npm script, started the way the platform allows. */
function npmStep(label, script) {
  return process.platform === 'win32'
    ? run(label, { line: `npm run ${script}` })
    : run(label, { command: 'npm', args: ['run', script] });
}

function main() {
  const fileEnv = readEnvFile(path.join(SERVER_ROOT, '.env'));
  // dotenv does not override what is already exported, so the API will read the same precedence.
  const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || '';
  if (!databaseUrl) {
    console.error('[deploy] DATABASE_URL nu e setat (nici în mediu, nici în server/.env).');
    process.exit(1);
  }

  const db = databaseName(databaseUrl);
  const expected = value('expect-db');
  if (expected && db !== expected) {
    // The companion and the full TMS are different databases on the same machine. Migrating the
    // wrong one is not something a later step would notice.
    console.error(`[deploy] DATABASE_URL arată spre „${db}”, nu spre „${expected}”. Oprit.`);
    process.exit(1);
  }

  const restart = value('restart');
  const steps = [
    has('skip-backup') ? null : 'backup',
    'migrare',
    has('skip-build') ? null : 'build companion',
    restart ? `restart (${restart})` : null,
  ].filter(Boolean);

  process.stdout.write(`[deploy] baza    ${db}\n`);
  process.stdout.write(`[deploy] url     ${maskUrl(databaseUrl)}\n`);
  process.stdout.write(`[deploy] pași    ${steps.join(' -> ')}\n`);
  if (!restart) {
    process.stdout.write('[deploy] fără --restart: repornește aplicația singur la final\n');
  }

  if (has('dry-run')) {
    process.stdout.write('\n[deploy] dry-run, nu am schimbat nimic.\n');
    return;
  }

  if (!has('skip-backup')) {
    npmStep('backup (bază + uploads)', 'db:backup');
  }

  // Before the build, never after: the schema has to be ready for the code that is about to
  // serve it, and a failure here leaves the running app untouched.
  npmStep('migrare', 'db:migrate');

  if (!has('skip-build')) {
    npmStep('build companion', 'build:companion');
  }

  if (restart) {
    run(`restart: ${restart}`, { line: restart });
  }

  process.stdout.write('\n[deploy] gata.\n');
  if (!restart) {
    process.stdout.write('[deploy] mai rămâne repornirea aplicației.\n');
  }
}

main();
