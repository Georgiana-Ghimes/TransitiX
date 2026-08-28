/** Baked in by vite/vitest `define` — the companion carries its own number. */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__).trim() : '0.0.0';

export const APP_BUILD =
  typeof __APP_BUILD__ !== 'undefined' ? String(__APP_BUILD__).trim() : 'dev';

export function formatAppVersion(version = APP_VERSION, { withBuild = true } = {}) {
  const raw = String(version || '').trim();
  const ver = !raw ? 'v0.0.0' : (raw.startsWith('v') ? raw : `v${raw}`);
  if (!withBuild) return ver;
  const build = String(APP_BUILD || '').trim();
  return build ? `${ver} - build ${build}` : ver;
}
