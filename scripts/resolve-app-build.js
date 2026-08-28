import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
);

/** Numeric build from package.json or VITE_APP_BUILD — baked into the UI at compile time. */
export function resolveAppBuild() {
  const fromEnv = String(process.env.VITE_APP_BUILD || '').trim();
  if (fromEnv) return fromEnv;
  const fromPkg = pkg.build;
  if (fromPkg != null && String(fromPkg).trim() !== '') return String(fromPkg).trim();
  return '1';
}
