/**
 * Public company slugs — URL segment /:slug/… alongside UUID PK.
 * Lowercase alphanumeric only (safe in paths, no punctuation).
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
  'reset-password',
  'uploads',
]);

/** Fixed product tenants — stable forever for demos / bookmarks. */
export const PRODUCT_SLUGS = {
  transitix_full: 'txdemo7k2m',
  rai_documents: 'raidocs4n9p',
};

const SLUG_RE = /^[a-z0-9]{8,24}$/;

export function isValidSlug(value) {
  const s = String(value || '').trim().toLowerCase();
  return SLUG_RE.test(s) && !RESERVED_SLUGS.has(s);
}

export function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

/** Random lowercase alphanumeric slug (default 10 chars). */
export function generateSlug(length = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  // Prefer crypto when available (Node / modern browsers).
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(length))
    : null;
  for (let i = 0; i < length; i += 1) {
    const n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    out += alphabet[n % alphabet.length];
  }
  if (RESERVED_SLUGS.has(out) || !SLUG_RE.test(out)) {
    return generateSlug(length);
  }
  return out;
}
