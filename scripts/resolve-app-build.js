import { execSync } from 'node:child_process';

/** Git short SHA or VITE_APP_BUILD — baked into the UI at compile time. */
export function resolveAppBuild() {
  const fromEnv = String(process.env.VITE_APP_BUILD || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}
