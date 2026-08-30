import { isPathAllowedForCompany, moduleForPath } from './companyModules.js';

/** Baseline office routes on VITE_APP_PROFILE=documents (always on for companion). */
export const COMPANION_OFFICE_PATHS = ['/avize', '/reports', '/platform'];

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
