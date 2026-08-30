/**
 * Platform (GOD) tenancy helpers.
 *
 * Customer `admin` is scoped to one company. Platform operators sit on a single
 * internal company (`is_platform = true`) with role `platform_admin`, so
 * `users.company_id` stays NOT NULL and every existing tenant filter keeps working.
 */

export const PLATFORM_COMPANY_NAME = 'Transitix Platform';

export async function ensurePlatformCompany(query) {
  const existing = await query(
    `SELECT id, name, is_platform, feature_flags
     FROM companies
     WHERE is_platform = TRUE
     LIMIT 1`,
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await query(
    `INSERT INTO companies (name, cui, is_platform, settings, feature_flags)
     VALUES ($1, $2, TRUE, '{}'::jsonb, '{}'::jsonb)
     RETURNING id, name, is_platform, feature_flags`,
    [PLATFORM_COMPANY_NAME, 'PLATFORM'],
  );
  return inserted.rows[0];
}

export function isPlatformAdminRole(role) {
  return role === 'platform_admin';
}
