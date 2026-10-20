/**
 * CLI: create / promote GOD admins from env.
 *
 *   PLATFORM_ADMIN_EMAILS=you@x.ro PLATFORM_ADMIN_BOOTSTRAP_PASSWORD='…' \
 *     npm run platform:bootstrap --prefix server
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, pool } from './db.js';
import { bootstrapPlatformAdmins } from './lib/platform/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

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
