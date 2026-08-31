/**
 * Public company slugs — URL segment /:slug/… alongside UUID PK.
 *
 * Model (stable for production):
 * - Every customer company gets a unique lowercase alphanumeric slug (default 10 chars).
 * - Allocation always checks the DB; collisions retry. Reserved path segments never win.
 * - UUID remains the primary key; slug is the public path identity (bookmarks, impersonation).
 * - Product demo tenants may use fixed slugs (PRODUCT_SLUGS) for stable demos only.
 * - Customer tenants never reuse product catalog app_keys — see tenantAppKey().
 */

export const RESERVED_SLUGS = new Set([
  'api',
  'assets',
  'confirm',
  'dev',
  'forgot-password',
  'login',
  'platform',
  'register',
  'request-access',
  'reset-password',
  'uploads',
]);

/** Fixed product tenants — stable forever for demos / bookmarks. */
export const PRODUCT_SLUGS = {
  transitix_full: 'txdemo7k2m',
  rai_documents: 'raidocs4n9p',
};

export const DEFAULT_SLUG_LENGTH = 10;
export const SLUG_MIN = 8;
export const SLUG_MAX = 24;
const SLUG_RE = /^[a-z0-9]{8,24}$/;
const PRODUCT_APP_KEYS = new Set(Object.keys(PRODUCT_SLUGS));

export function isValidSlug(value) {
  const s = String(value || '').trim().toLowerCase();
  return SLUG_RE.test(s) && !RESERVED_SLUGS.has(s);
}

export function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

/** Random lowercase alphanumeric candidate (not yet uniqueness-checked). */
export function generateSlug(length = DEFAULT_SLUG_LENGTH) {
  const len = Math.min(SLUG_MAX, Math.max(SLUG_MIN, Number(length) || DEFAULT_SLUG_LENGTH));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(len))
    : null;
  for (let i = 0; i < len; i += 1) {
    const n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    out += alphabet[n % alphabet.length];
  }
  if (RESERVED_SLUGS.has(out) || !SLUG_RE.test(out)) {
    return generateSlug(len);
  }
  return out;
}

/** Feature-flag app_key for a customer tenant — never a product catalog key. */
export function tenantAppKey(slug) {
  const s = normalizeSlug(slug);
  return `tenant_${s}`;
}

export function isProductAppKey(appKey) {
  return PRODUCT_APP_KEYS.has(String(appKey || ''));
}

/**
 * Allocate a free public slug.
 *
 * @param {Function} queryFn - `(sql, params) => Promise<{ rows }>` (pool.query or tx client)
 * @param {object} [opts]
 * @param {string} [opts.preferred] - optional explicit slug (must be free + valid)
 * @param {string} [opts.excludeCompanyId] - ignore this company when checking uniqueness (rename)
 * @param {number} [opts.length] - random length when preferred is empty
 * @param {number} [opts.maxAttempts]
 * @returns {Promise<string>}
 */
export async function allocateUniqueSlug(queryFn, opts = {}) {
  const preferred = opts.preferred != null && String(opts.preferred).trim()
    ? normalizeSlug(opts.preferred)
    : null;
  const excludeId = opts.excludeCompanyId ? String(opts.excludeCompanyId) : null;
  const length = opts.length || DEFAULT_SLUG_LENGTH;
  const maxAttempts = opts.maxAttempts || 12;

  async function isFree(slug) {
    const result = excludeId
      ? await queryFn(
        `SELECT id FROM companies WHERE slug = $1 AND id <> $2 LIMIT 1`,
        [slug, excludeId],
      )
      : await queryFn(
        `SELECT id FROM companies WHERE slug = $1 LIMIT 1`,
        [slug],
      );
    return !result.rows[0];
  }

  if (preferred) {
    if (!isValidSlug(preferred)) {
      const err = new Error('Slug invalid (8–24 caractere alfanumerice, fără segmente rezervate).');
      err.status = 400;
      err.code = 'SLUG_INVALID';
      throw err;
    }
    if (!(await isFree(preferred))) {
      const err = new Error('Slug-ul este deja folosit.');
      err.status = 409;
      err.code = 'SLUG_TAKEN';
      throw err;
    }
    return preferred;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = generateSlug(length);
    if (await isFree(slug)) return slug;
  }

  const err = new Error('Nu am putut aloca un slug unic. Reîncearcă.');
  err.status = 500;
  err.code = 'SLUG_EXHAUSTED';
  throw err;
}
