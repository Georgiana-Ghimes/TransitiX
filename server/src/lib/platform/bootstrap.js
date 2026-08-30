/**
 * Promote / create platform admins from env — never hardcode accounts in source.
 *
 * PLATFORM_ADMIN_EMAILS=you@transitix.ro,ops@transitix.ro
 * PLATFORM_ADMIN_BOOTSTRAP_PASSWORD=…   (required when creating a brand-new user)
 *
 * Re-running is safe: existing users with those emails are elevated to platform_admin
 * on the platform company; passwords are left alone unless the user is newly created.
 */

import bcrypt from 'bcryptjs';
import { ensurePlatformCompany } from './company.js';

function parseEmails(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function bootstrapPlatformAdmins(query, {
  emails = process.env.PLATFORM_ADMIN_EMAILS,
  password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD,
} = {}) {
  const list = parseEmails(emails);
  if (!list.length) {
    return { ok: false, reason: 'no_emails', created: 0, promoted: 0, emails: [] };
  }

  const platform = await ensurePlatformCompany(query);
  const results = [];
  let created = 0;
  let promoted = 0;

  for (const email of list) {
    const found = await query(
      `SELECT id, email, role, company_id, is_active
       FROM users
       WHERE lower(email) = $1
       ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END, created_at
       LIMIT 1`,
      [email, platform.id],
    );
    const row = found.rows[0];

    if (!row) {
      const pwd = String(password || '').trim();
      if (pwd.length < 10) {
        results.push({ email, action: 'skipped', reason: 'need_password' });
        continue;
      }
      const password_hash = await bcrypt.hash(pwd, 12);
      const name = email.split('@')[0] || 'Platform admin';
      await query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'platform_admin', TRUE)`,
        [platform.id, name, email, password_hash],
      );
      created += 1;
      results.push({ email, action: 'created' });
      continue;
    }

    await query(
      `UPDATE users
       SET company_id = $1,
           role = 'platform_admin',
           is_active = TRUE,
           updated_at = NOW()
       WHERE id = $2`,
      [platform.id, row.id],
    );
    promoted += 1;
    results.push({
      email,
      action: row.role === 'platform_admin' && row.company_id === platform.id ? 'unchanged' : 'promoted',
    });
  }

  return {
    ok: true,
    platform_company_id: platform.id,
    created,
    promoted,
    results,
  };
}
