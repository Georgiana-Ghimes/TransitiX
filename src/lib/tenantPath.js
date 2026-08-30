/**
 * Public company slugs — URL segment /:slug/… alongside UUID PK.
 * Keep in sync with server/src/lib/platform/slug.js
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

export const PRODUCT_SLUGS = {
  transitix_full: 'txdemo7k2m',
  rai_documents: 'raidocs4n9p',
};

export function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidSlug(value) {
  const s = normalizeSlug(value);
  return /^[a-z0-9]{8,24}$/.test(s) && !RESERVED_SLUGS.has(s);
}

/**
 * Detect public tenant slug from the browser path (before auth resolves).
 * Reserved first segments (login, platform, …) are never treated as companies.
 */
export function detectSlugFromPath(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  const path = String(pathname || '').split('?')[0];
  const seg = path.split('/').filter(Boolean)[0] || '';
  const slug = normalizeSlug(seg);
  if (!isValidSlug(slug)) return null;
  return slug;
}

/** Build /{slug}/trips from slug + app path. Platform / login stay unprefixed. */
export function tenantPath(slug, path = '/') {
  const s = normalizeSlug(slug);
  let p = String(path || '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (!s) return p;
  if (p === '/') return `/${s}`;
  return `/${s}${p}`;
}

/** Strip /{slug} prefix so module maps stay absolute (/avize, /trips). */
export function stripTenantSlug(pathname, slug) {
  const path = String(pathname || '').split('?')[0] || '/';
  const s = normalizeSlug(slug) || detectSlugFromPath(path);
  if (!s) return path;
  if (path === `/${s}`) return '/';
  if (path.startsWith(`/${s}/`)) {
    const rest = path.slice(s.length + 1);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return path;
}
