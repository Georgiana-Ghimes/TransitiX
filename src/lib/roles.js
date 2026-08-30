import { isCompanionOfficePath, isDocumentsProfile } from './appProfile.js';
import { stripTenantSlug, tenantPath } from './tenantPath.js';

export const OFFICE_ROLES = ['admin', 'dispatcher', 'finance'];

function isDocumentsCompany(userOrRole) {
  if (typeof userOrRole === 'object' && userOrRole?.company?.feature_flags?.app_profile === 'documents') {
    return true;
  }
  if (typeof userOrRole === 'object' && userOrRole?.company?.feature_flags?.app_profile === 'full') {
    return false;
  }
  return isDocumentsProfile();
}

/** In-router path (no /{slug} — BrowserRouter basename adds it). */
function officeHomePath(userOrRole) {
  return isDocumentsCompany(userOrRole) ? '/avize' : '/';
}

export function isDriverRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'driver';
}

export function isOfficeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return OFFICE_ROLES.includes(role);
}

/** Transitix operator — not a customer company admin. */
export function isPlatformAdmin(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'platform_admin';
}

/** Default landing path for <Navigate> / Links inside the tenant basename. */
export function homePathForRole(userOrRole) {
  if (isPlatformAdmin(userOrRole)) return '/platform';
  if (isDriverRole(userOrRole)) return '/driver-app';
  return officeHomePath(userOrRole);
}

/**
 * Absolute browser path after login / impersonation (includes /{slug} when present).
 * Used with window.location.href — not with React Router Navigate.
 */
export function postLoginPath(userOrRole, returnTo = '/') {
  if (isPlatformAdmin(userOrRole)) {
    if (String(returnTo || '').startsWith('/platform')) return returnTo;
    return '/platform';
  }

  const slug = typeof userOrRole === 'object' ? userOrRole?.company?.slug : null;

  if (isDriverRole(userOrRole)) {
    return tenantPath(slug, '/driver-app');
  }

  const rawFull = String(returnTo || '/');
  const pathOnly = rawFull.split('?')[0];
  const qs = rawFull.includes('?') ? rawFull.slice(rawFull.indexOf('?')) : '';

  if (pathOnly && pathOnly !== '/' && pathOnly !== '/driver-app' && !pathOnly.startsWith('/login')) {
    // Already absolute with this company's slug
    if (slug && (pathOnly === `/${slug}` || pathOnly.startsWith(`/${slug}/`))) {
      return rawFull;
    }
    const bare = stripTenantSlug(pathOnly, slug);
    if (bare && bare !== '/') {
      if (isDocumentsCompany(userOrRole)) {
        if (isCompanionOfficePath(bare, userOrRole)) {
          return tenantPath(slug, bare) + qs;
        }
      } else {
        return tenantPath(slug, bare) + qs;
      }
    }
  }

  return tenantPath(slug, officeHomePath(userOrRole));
}
