/**
 * Office routes exposed when VITE_APP_PROFILE=documents (RAI companion).
 * `/users` is here because an admin who cannot invite and link a driver from the UI has to
 * seed the database by hand — the screen itself is already role-gated to admin.
 */
export const COMPANION_OFFICE_PATHS = ['/avize', '/reports', '/settings', '/users'];

export function appProfile() {
  const raw = String(import.meta.env.VITE_APP_PROFILE || 'full').trim().toLowerCase();
  return raw === 'documents' ? 'documents' : 'full';
}

export function isDocumentsProfile() {
  return appProfile() === 'documents';
}

export function isCompanionOfficePath(pathname) {
  const path = String(pathname || '').split('?')[0];
  return COMPANION_OFFICE_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

export function companionAppTitle() {
  const custom = String(import.meta.env.VITE_APP_TITLE || '').trim();
  return custom || 'Transitix';
}

export function companionTagline() {
  const custom = String(import.meta.env.VITE_APP_TAGLINE || '').trim();
  return custom || 'Companionul tău pentru documente';
}
