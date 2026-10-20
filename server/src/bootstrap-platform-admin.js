/**
 * CLI: create / promote GOD admins from env.
 *
 *   PLATFORM_ADMIN_EMAILS=you@x.ro PLATFORM_ADMIN_BOOTSTRAP_PASSWORD='…' \
 *     npm run platform:bootstrap --prefix server
 *
 * Companion DB (local :5435 / VM RAI):
 *   COMPANION=1 PLATFORM_ADMIN_EMAILS=… PLATFORM_ADMIN_BOOTSTRAP_PASSWORD='…' \
 *     npm run platform:bootstrap --prefix server
 */
import './loadEnv.js';
import { query, pool } from './db.js';
import { bootstrapPlatformAdmins } from './lib/platform/bootstrap.js';

const result = await bootstrapPlatformAdmins(query);
await pool.end();

if (!result.ok && result.reason === 'no_emails') {
  console.error('Set PLATFORM_ADMIN_EMAILS (comma-separated) in the environment.');
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
const skipped = (result.results || []).filter((r) => r.action === 'skipped');
if (skipped.length) {
  console.error('Some emails need PLATFORM_ADMIN_BOOTSTRAP_PASSWORD (≥10 chars) to create a new user.');
  process.exit(2);
}
