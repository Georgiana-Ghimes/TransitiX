/**
 * Start the API with COMPANION=1 so server/.env.companion overrides .env
 * (port 3002, RAI DB, Mistral key).
 *
 *   node scripts/dev-companion-api.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, COMPANION: '1' };
const child = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev'],
  { cwd: path.join(root, 'server'), env, stdio: 'inherit', shell: true },
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
