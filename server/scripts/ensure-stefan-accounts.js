/**
 * Ensure RAI client accounts exist (idempotent).
 *
 *   stefan@transitix.ro       — office (admin), name Stefan
 *   sofer-stefan@transitix.ro — driver login; driver profile name placeholder until filled in
 *
 * Usage:
 *   node scripts/ensure-stefan-accounts.js
 *   COMPANION=1 node scripts/ensure-stefan-accounts.js          # companion DB (:5435)
 *   ENSURE_RESET_PASSWORD=1 node scripts/ensure-stefan-accounts.js
 *
 * Optional env:
 *   COMPANY_ID              — target company (default: oldest company)
 *   STEFAN_PASSWORD         — office password (default: generated temp)
 *   SOFER_STEFAN_PASSWORD   — driver password (default: generated temp)
 *   ENSURE_RESET_PASSWORD=1 — also rotate password when the user already exists
 *
 * Safe for VM / prod: existing users keep their password unless reset is requested;
 * new or reset accounts get must_change_password = true.
 */
import '../src/loadEnv.js';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { temporaryPassword, passwordProblem } from '../src/lib/auth/signup.js';
import { STEFAN_ACCOUNTS } from '../src/lib/stefanAccounts.js';

export { STEFAN_ACCOUNTS };

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function truthy(v) {
  return ['1', 'true', 'yes'].includes(String(v || '').trim().toLowerCase());
}

function resolvePassword(envName, email) {
  const fromEnv = String(process.env[envName] || '').trim();
  if (fromEnv) {
    const problem = passwordProblem(fromEnv, { email });
    if (problem) throw new Error(`${envName}: ${problem}`);
    return { password: fromEnv, generated: false };
  }
  return { password: temporaryPassword(), generated: true };
}

async function resolveCompanyId(client) {
  const pinned = String(process.env.COMPANY_ID || '').trim();
  if (pinned) {
    const found = await client.query(`SELECT id, name FROM companies WHERE id = $1`, [pinned]);
    if (!found.rows[0]) throw new Error(`COMPANY_ID ${pinned} nu există.`);
    return found.rows[0];
  }
  const row = await client.query(
    `SELECT id, name FROM companies ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1`,
  );
  if (!row.rows[0]) {
    throw new Error('Nicio companie în baza de date. Creează una (seed / signup) înainte.');
  }
  return row.rows[0];
}

/**
 * @returns {Promise<{ email: string, role: string, created: boolean, passwordReset: boolean, temporaryPassword?: string, driverId?: string }>}
 */
export async function ensureAccount(client, company, spec, { resetPassword = false } = {}) {
  const email = normaliseEmail(spec.email);
  const existing = await client.query(
    `SELECT id, role, must_change_password FROM users
     WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
    [company.id, email],
  );

  let userId;
  let created = false;
  let passwordReset = false;
  let temporary = undefined;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE users
       SET name = $1,
           role = $2,
           is_active = TRUE,
           email_verified_at = COALESCE(email_verified_at, NOW()),
           updated_at = NOW()
       WHERE id = $3`,
      [spec.name, spec.role, userId],
    );
    if (resetPassword) {
      const { password, generated } = resolvePassword(spec.passwordEnv, email);
      await client.query(
        `UPDATE users
         SET password_hash = $1, must_change_password = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [await bcrypt.hash(password, 12), userId],
      );
      passwordReset = true;
      if (generated) temporary = password;
      else temporary = password;
    }
  } else {
    const { password, generated } = resolvePassword(spec.passwordEnv, email);
    const inserted = await client.query(
      `INSERT INTO users (
         company_id, name, email, password_hash, role,
         created_via, must_change_password, email_verified_at, is_active
       ) VALUES ($1, $2, $3, $4, $5, 'manual', TRUE, NOW(), TRUE)
       RETURNING id`,
      [company.id, spec.name, email, await bcrypt.hash(password, 12), spec.role],
    );
    userId = inserted.rows[0].id;
    created = true;
    passwordReset = true;
    temporary = password;
    void generated;
  }

  let driverId;
  if (spec.driver) {
    const driverName = spec.driverName || spec.name;
    const linked = await client.query(
      `SELECT id FROM drivers WHERE company_id = $1 AND user_id = $2`,
      [company.id, userId],
    );
    if (linked.rows[0]) {
      driverId = linked.rows[0].id;
      // Do not overwrite a real name once someone filled it in.
      await client.query(
        `UPDATE drivers
         SET email = $1,
             name = CASE
               WHEN name IS NULL OR BTRIM(name) = ''
                 OR BTRIM(name) IN ('Șofer', 'Sofer', 'șofer', 'sofer')
               THEN $2 ELSE name END,
             is_active = TRUE,
             updated_at = NOW()
         WHERE id = $3`,
        [email, driverName, driverId],
      );
    } else {
      const byEmail = await client.query(
        `SELECT id FROM drivers
         WHERE company_id = $1 AND user_id IS NULL AND LOWER(email) = LOWER($2)`,
        [company.id, email],
      );
      if (byEmail.rows[0]) {
        driverId = byEmail.rows[0].id;
        await client.query(
          `UPDATE drivers
           SET user_id = $1, email = $2, is_active = TRUE, updated_at = NOW()
           WHERE id = $3`,
          [userId, email, driverId],
        );
      } else {
        const createdDriver = await client.query(
          `INSERT INTO drivers (company_id, user_id, name, email, phone, status, is_active)
           VALUES ($1, $2, $3, $4, $5, 'disponibil', TRUE)
           RETURNING id`,
          [company.id, userId, driverName, email, '-'],
        );
        driverId = createdDriver.rows[0].id;
      }
    }
  }

  return {
    email,
    role: spec.role,
    created,
    passwordReset,
    temporaryPassword: temporary,
    driverId,
  };
}

async function main() {
  const resetPassword = truthy(process.env.ENSURE_RESET_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await resolveCompanyId(client);
    const results = [];
    for (const spec of STEFAN_ACCOUNTS) {
      results.push(await ensureAccount(client, company, spec, { resetPassword }));
    }
    await client.query('COMMIT');

    console.log(`Companie: ${company.name} (${company.id})`);
    for (const r of results) {
      const state = r.created ? 'creat' : (r.passwordReset ? 'actualizat + parolă nouă' : 'deja există');
      console.log(`  ${r.email} [${r.role}] — ${state}`);
      if (r.driverId) console.log(`    driver_id: ${r.driverId}`);
      if (r.temporaryPassword) {
        console.log(`    parolă temporară: ${r.temporaryPassword}`);
        console.log('    (must_change_password = true — schimbă la primul login)');
      }
    }
    if (!results.some((r) => r.temporaryPassword) && !resetPassword) {
      console.log('Parolele existente au rămas neschimbate. Pentru rotire: ENSURE_RESET_PASSWORD=1');
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error(err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1]
  && String(process.argv[1]).replace(/\\/g, '/').endsWith('/ensure-stefan-accounts.js');

if (isMain) {
  main();
}
