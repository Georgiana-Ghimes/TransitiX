import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
);

/**
 * What the UI shows as its version, baked in at compile time.
 *
 * The companion is numbered separately from Transitix: it is the same codebase but a different
 * product to the customer, and rewriting `version` for it would have reset the whole product's
 * semver line — the release hook bumps from whatever it finds there.
 */
export function resolveAppBuild(mode) {
  const fromEnv = String(process.env.VITE_APP_BUILD || '').trim();
  if (fromEnv) return fromEnv;
  const fromPkg = mode === 'companion' ? pkg.companion?.build : pkg.build;
  if (fromPkg != null && String(fromPkg).trim() !== '') return String(fromPkg).trim();
  return '1';
}

export function resolveAppVersion(mode) {
  const fromEnv = String(process.env.VITE_APP_VERSION || '').trim();
  if (fromEnv) return fromEnv;
  if (mode === 'companion' && pkg.companion?.version) return String(pkg.companion.version);
  return pkg.version;
}

/** The customer-facing name. Env wins, so one-off builds can be relabelled. */
export function resolveAppTitle(mode) {
  const fromEnv = String(process.env.VITE_APP_TITLE || '').trim();
  if (fromEnv) return fromEnv;
  if (mode === 'companion' && pkg.companion?.title) return String(pkg.companion.title);
  return '';
}

/**
 * Which app a build produces.
 *
 * Derived from the build mode, not from a `.env.companion` somebody has to remember to create:
 * `vite build --mode companion` without that file silently produced the full Transitix app, and
 * nothing failed — the wrong product just shipped. Env still wins, for one-off builds.
 */
export function resolveAppProfile(mode) {
  const fromEnv = String(process.env.VITE_APP_PROFILE || '').trim().toLowerCase();
  if (fromEnv) return fromEnv === 'documents' ? 'documents' : 'full';
  return mode === 'companion' ? 'documents' : 'full';
}
