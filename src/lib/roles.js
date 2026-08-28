import { isCompanionOfficePath, isDocumentsProfile } from './appProfile.js';

export const OFFICE_ROLES = ['admin', 'dispatcher', 'finance'];

function officeHomePath() {
  return isDocumentsProfile() ? '/avize' : '/';
}

export function isDriverRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'driver';
}

export function isOfficeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return OFFICE_ROLES.includes(role);
}

/** Default landing path after login / when a role hits a forbidden area. */
export function homePathForRole(userOrRole) {
  if (isDriverRole(userOrRole)) return '/driver-app';
  return officeHomePath();
}

/**
 * Where to send the user after a successful login.
 * Drivers always land on the driver app. Office users honor returnTo,
 * except /driver-app (common when switching away from a driver session).
 */
export function postLoginPath(userOrRole, returnTo = '/') {
  if (isDriverRole(userOrRole)) return '/driver-app';
  if (isDocumentsProfile()) {
    const path = String(returnTo || '').split('?')[0];
    if (path && path !== '/' && path !== '/driver-app' && isCompanionOfficePath(path)) {
      return returnTo;
    }
    return '/avize';
  }
  if (!returnTo || returnTo === '/driver-app') return '/';
  return returnTo;
}
