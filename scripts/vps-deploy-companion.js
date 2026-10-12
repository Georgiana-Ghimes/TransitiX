/**
 * Un singur comandă pe VPS (Linux) pentru update companion PROD:
 *
 *   git → npm ci → deploy-companion (backup → migrate → build → restart) → Caddy → health
 *
 *   cd /opt/rai/TransitiX
 *   npm run deploy:companion:vps
 *
 * Opțiuni:
 *   --branch NAME     default TRANSITIX-RAI-PROD
 *   --expect-db NAME  default transitix_rai
 *   --restart CMD     default: systemctl restart rai-api
 *   --skip-git        nu face fetch/reset (codul e deja pe disc)
 *   --skip-npm-ci     sare peste npm ci
 *   --skip-backup     transmis la deploy-companion.js
 *   --skip-build      transmis la deploy-companion.js
 *   --skip-health     nu face curl pe /api/health
 *   --dry-run         afișează planul, nu schimbă nimic
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ROOT = path.join(ROOT, 'server');
const COMPANION_ENV = path.join(SERVER_ROOT, '.env.companion');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function run(label, { command, argv = [], line = null, env = process.env }) {
  process.stdout.write(`\n[vps-deploy] ${label}\n`);
  const settings = { cwd: ROOT, stdio: 'inherit', env };
  const result = line
    ? spawnSync(line, { ...settings, shell: true })
    : spawnSync(command, argv, settings);

  if (result.error?.code === 'ENOENT') {
    console.error(`[vps-deploy] ${line || command} nu există pe PATH. Oprit la „${label}”.`);
    process.exit(1);
  }
  if (result.error) {
    console.error(`[vps-deploy] „${label}” nu a putut porni: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    const how = result.status === null
      ? `oprit de semnalul ${result.signal}`
      : `cod ${result.status}`;
    console.error(`[vps-deploy] „${label}” a eșuat (${how}). Nu merg mai departe.`);
    process.exit(1);
  }
}

function main() {
  if (process.platform === 'win32' && !has('allow-windows')) {
    console.error(
      '[vps-deploy] Scriptul e pentru VPS Linux. Pe PC folosește git merge + push; pe VPS: npm run deploy:companion:vps',
    );
    process.exit(1);
  }

  const branch = value('branch', 'TRANSITIX-RAI-PROD');
  const expectDb = value('expect-db', 'transitix_rai');
  const restart = value('restart', 'systemctl restart rai-api');

  if (!fs.existsSync(COMPANION_ENV)) {
    console.error(`[vps-deploy] Lipsește ${COMPANION_ENV}. Oprit.`);
    process.exit(1);
  }

  const companionEnv = readEnvFile(COMPANION_ENV);
  const databaseUrl = process.env.DATABASE_URL || companionEnv.DATABASE_URL || '';
  if (!databaseUrl) {
    console.error('[vps-deploy] DATABASE_URL lipsește din server/.env.companion.');
    process.exit(1);
  }

  const plan = [
    has('skip-git') ? null : `git → origin/${branch}`,
    has('skip-npm-ci') ? null : 'npm ci (root + server)',
    'deploy-companion (backup → migrate → build → restart)',
    'caddy reload',
    has('skip-health') ? null : 'health check',
  ].filter(Boolean);

  process.stdout.write(`[vps-deploy] root    ${ROOT}\n`);
  process.stdout.write(`[vps-deploy] branch  ${branch}\n`);
  process.stdout.write(`[vps-deploy] expect  ${expectDb}\n`);
  process.stdout.write(`[vps-deploy] restart ${restart}\n`);
  process.stdout.write(`[vps-deploy] pași    ${plan.join(' → ')}\n`);

  if (has('dry-run')) {
    process.stdout.write('\n[vps-deploy] dry-run, nu am schimbat nimic.\n');
    return;
  }

  const env = {
    ...process.env,
    COMPANION: '1',
    NODE_ENV: process.env.NODE_ENV || 'production',
    DATABASE_URL: databaseUrl,
  };

  if (!has('skip-git')) {
    run('git fetch', { command: 'git', argv: ['fetch', 'origin', branch], env });
    run('git checkout', { command: 'git', argv: ['checkout', branch], env });
    run('git reset --hard', { command: 'git', argv: ['reset', '--hard', `origin/${branch}`], env });
  }

  if (!has('skip-npm-ci')) {
    run('npm ci (root)', { command: 'npm', argv: ['ci'], env });
    run('npm ci (server)', { command: 'npm', argv: ['ci', '--prefix', 'server'], env });
  }

  const deployArgs = [
    path.join(ROOT, 'scripts', 'deploy-companion.js'),
    '--expect-db',
    expectDb,
    '--restart',
    restart,
  ];
  if (has('skip-backup')) deployArgs.push('--skip-backup');
  if (has('skip-build')) deployArgs.push('--skip-build');

  run('deploy-companion', { command: process.execPath, argv: deployArgs, env });

  // Best-effort: UI e static în dist/; reload nu e obligatoriu dacă Caddy e deja pe root.
  process.stdout.write('\n[vps-deploy] caddy reload\n');
  const caddy = spawnSync('systemctl', ['reload', 'caddy'], { cwd: ROOT, stdio: 'inherit', env });
  if (caddy.status !== 0) {
    process.stdout.write('[vps-deploy] caddy reload a eșuat (ignorat — verifică manual dacă e nevoie)\n');
  }

  if (!has('skip-health')) {
    run('health', {
      line: 'curl -fsS http://127.0.0.1:3002/api/health',
      env,
    });
  }

  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const oneline = spawnSync('git', ['log', '-1', '--oneline'], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });

  process.stdout.write(`\n[vps-deploy] gata · ${String(rev.stdout || '').trim()}\n`);
  if (oneline.stdout) process.stdout.write(`[vps-deploy] ${oneline.stdout.trim()}\n`);
}

main();
