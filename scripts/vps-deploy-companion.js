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
 *   --strict-health   dacă health eșuează → exit 1 (implicit: doar avertisment, exit 0)
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

  // Git / health: COMPANION + DATABASE_URL. Nu forța NODE_ENV=production pe npm ci —
  // altfel vite (devDependency) lipsește și build:companion crapă cu „vite: not found”.
  const env = {
    ...process.env,
    COMPANION: '1',
    DATABASE_URL: databaseUrl,
  };
  // npm tratează production din NODE_ENV *și* din npm_config_*; ambele trebuie oprite la ci,
  // altfel vite (devDependency) lipsește și build:companion crapă.
  const envCi = {
    ...env,
    NODE_ENV: 'development',
    NPM_CONFIG_PRODUCTION: 'false',
    npm_config_production: 'false',
  };
  const envProd = {
    ...env,
    NODE_ENV: 'production',
  };

  if (!has('skip-git')) {
    run('git fetch', { command: 'git', argv: ['fetch', 'origin', branch], env });
    run('git checkout', { command: 'git', argv: ['checkout', branch], env });
    run('git reset --hard', { command: 'git', argv: ['reset', '--hard', `origin/${branch}`], env });
  }

  if (!has('skip-npm-ci')) {
    run('npm ci (root)', {
      command: 'npm',
      argv: ['ci', '--include=dev', '--no-fund', '--no-audit'],
      env: envCi,
    });
    run('npm ci (server)', {
      command: 'npm',
      argv: ['ci', '--prefix', 'server', '--include=dev', '--no-fund', '--no-audit'],
      env: envCi,
    });
  }

  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    console.error(
      `[vps-deploy] Lipsește ${viteBin}. Rulează fără --skip-npm-ci, sau:\n` +
        '  NPM_CONFIG_PRODUCTION=false npm ci --include=dev',
    );
    process.exit(1);
  }
  process.stdout.write(`[vps-deploy] vite ok  ${viteBin}\n`);

  const deployArgs = [
    path.join(ROOT, 'scripts', 'deploy-companion.js'),
    '--expect-db',
    expectDb,
    '--restart',
    restart,
  ];
  if (has('skip-backup')) deployArgs.push('--skip-backup');
  if (has('skip-build')) deployArgs.push('--skip-build');

  run('deploy-companion', { command: process.execPath, argv: deployArgs, env: envProd });

  // Best-effort: UI e static în dist/; reload nu e obligatoriu dacă Caddy e deja pe root.
  process.stdout.write('\n[vps-deploy] caddy reload\n');
  const caddy = spawnSync('systemctl', ['reload', 'caddy'], { cwd: ROOT, stdio: 'inherit', env: envProd });
  if (caddy.status !== 0) {
    process.stdout.write('[vps-deploy] caddy reload a eșuat (ignorat — verifică manual dacă e nevoie)\n');
  }

  let healthOk = true;
  if (!has('skip-health')) {
    // După systemctl restart API-ul are nevoie de câteva secunde; un curl instant e fals negativ.
    const healthUrl = 'http://127.0.0.1:3002/api/health';
    const attempts = 30;
    const delayMs = 2000;
    process.stdout.write(
      `\n[vps-deploy] health — verificare opțională (curl pe ${healthUrl}, până la ${attempts}×${delayMs / 1000}s)\n` +
        '[vps-deploy] (backup → migrate → build → restart s-au terminat deja; asta e doar o confirmare)\n',
    );
    healthOk = false;
    for (let i = 1; i <= attempts; i += 1) {
      const probe = spawnSync('curl', ['-fsS', '--max-time', '3', healthUrl], {
        cwd: ROOT,
        encoding: 'utf8',
        env: envProd,
      });
      if (probe.status === 0) {
        process.stdout.write(`[vps-deploy] health OK (încercarea ${i}) — API răspunde, totul e în regulă.\n`);
        if (probe.stdout) process.stdout.write(`${probe.stdout.trim()}\n`);
        healthOk = true;
        break;
      }
      process.stdout.write(`[vps-deploy] health: aștept pornirea API… (${i}/${attempts})\n`);
      spawnSync('sleep', [String(delayMs / 1000)], { stdio: 'ignore' });
    }
    if (!healthOk) {
      // Nu ieșim cu panică: deploy-ul e făcut; probe-ul poate eșua dacă API-ul pornește mai greu.
      process.stdout.write(`
[vps-deploy] ────────────────────────────────────────────────────────────
[vps-deploy] Health check: curl pe :3002 nu a răspuns la timp.
[vps-deploy]
[vps-deploy] Asta NU înseamnă că aplicația e stricată sau că deploy-ul
[vps-deploy] a eșuat. Build + restart s-au terminat deja cu succes.
[vps-deploy] De obicei API-ul mai are nevoie de câteva secunde.
[vps-deploy]
[vps-deploy] Linistește-te — verifică tu (dacă răspunde, ești OK):
[vps-deploy]   curl -sS http://127.0.0.1:3002/api/health
[vps-deploy]   curl -sS https://rai-transitix.filumforge.ro/api/health
[vps-deploy]   → deschide site-ul în browser (login)
[vps-deploy]
[vps-deploy] Dacă tot nu răspunde după ~1 min:
[vps-deploy]   systemctl status rai-api --no-pager
[vps-deploy]   journalctl -u rai-api -n 80 --no-pager
[vps-deploy] ────────────────────────────────────────────────────────────
`);
      if (has('strict-health')) {
        console.error('[vps-deploy] --strict-health: opresc cu cod 1 (doar probe-ul a eșuat).');
        process.exit(1);
      }
      process.stdout.write(
        '[vps-deploy] Continui (exit 0) — deploy-ul e considerat făcut; health e doar avertisment.\n',
      );
    }
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

  process.stdout.write(`\n[vps-deploy] gata · ${String(rev.stdout || '').trim()}`);
  process.stdout.write(healthOk ? ' · health OK\n' : ' · health: avertisment (vezi mai sus)\n');
  if (oneline.stdout) process.stdout.write(`[vps-deploy] ${oneline.stdout.trim()}\n`);
}

main();
