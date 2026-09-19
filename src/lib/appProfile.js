import { isPathAllowedForCompany, moduleForPath } from './companyModules.js';

/**
 * Office routes exposed when VITE_APP_PROFILE=documents (RAI companion).
 * Utilizatori lives under Setări (tab), not as its own sidebar item; `/users` still
 * redirects there so old bookmarks keep working. Harta zonelor is shared with full TMS.
 * `/platform` is for GOD operators on the same host.
 */
export const COMPANION_OFFICE_PATHS = [
  '/avize',
  '/reports',
  '/zone-map',
  '/fleet',
  '/settings',
  '/users',
  '/ghid',
  '/platform',
];

export function appProfile() {
  const raw = String(import.meta.env.VITE_APP_PROFILE || 'full').trim().toLowerCase();
  return raw === 'documents' ? 'documents' : 'full';
}

export function isDocumentsProfile() {
  return appProfile() === 'documents';
}

/**
 * Companion may also open TMS routes when the company's feature_flags.modules
 * has them enabled (platform GOD toggles). Without a user, only the baseline applies.
 */
export function isCompanionOfficePath(pathname, userOrCompany = null) {
  const path = String(pathname || '').split('?')[0];
  if (COMPANION_OFFICE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return true;
  }
  // Role strings (e.g. postLoginPath('admin', …)) have no company flags — baseline only.
  if (!userOrCompany || typeof userOrCompany !== 'object') return false;
  const mod = moduleForPath(path);
  if (!mod) return false;
  return isPathAllowedForCompany(userOrCompany, path);
}

export function companionAppTitle() {
  const custom = String(import.meta.env.VITE_APP_TITLE || '').trim();
  return custom || 'Transitix';
}

export function companionTagline() {
  const custom = String(import.meta.env.VITE_APP_TAGLINE || '').trim();
  return custom || 'Companionul tău pentru documente';
}
