export const OFFICE_ROLES = ['admin', 'dispatcher', 'finance'];

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
  return isDriverRole(userOrRole) ? '/driver-app' : '/';
}

/**
 * Where to send the user after a successful login.
 * Drivers always land on the driver app. Office users honor returnTo,
 * except /driver-app (common when switching away from a driver session).
 */
export function postLoginPath(userOrRole, returnTo = '/') {
  if (isDriverRole(userOrRole)) return '/driver-app';
  if (!returnTo || returnTo === '/driver-app') return '/';
  return returnTo;
}
