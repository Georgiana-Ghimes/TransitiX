import { normalizeFlags } from '@/lib/platformFlags';

/**
 * Map tenant routes → feature_flags.modules keys.
 * Missing mapping = always allowed (e.g. dashboard, settings).
 */
export const PATH_MODULE = {
  '/dispatch': 'dispatch',
  '/loading': 'loading',
  '/load-planner': 'loading',
  '/trips': 'trips',
  '/vehicles': 'fleet',
  '/drivers': 'fleet',
  '/locations': 'locations',
  '/territories': 'territories',
  '/gps': 'gps',
  '/planning': 'planning',
  '/clients': 'trips',
  '/finance': 'finance',
  '/warehouse': 'warehouse',
  '/documents': 'documents_expiry',
  '/avize': 'avize',
  '/reports': 'reports',
  '/commercial': 'commercial',
  '/users': 'users_admin',
  '/audit': 'audit',
  '/checks': 'avize',
};

export function companyModules(userOrCompany) {
  const flags = (userOrCompany && typeof userOrCompany === 'object')
    ? (userOrCompany.company?.feature_flags
      ?? userOrCompany.feature_flags
      ?? (userOrCompany.modules ? userOrCompany : null)
      ?? {})
    : {};
  return normalizeFlags(flags).modules;
}

export function isModuleEnabled(userOrCompany, moduleKey) {
  if (!moduleKey) return true;
  if (userOrCompany?.role === 'platform_admin') return true;
  const modules = companyModules(userOrCompany);
  // Explicit false only — missing catalog key treated as on for older rows without flags
  if (!modules || Object.keys(modules).length === 0) return true;
  return modules[moduleKey] !== false;
}

export function moduleForPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (PATH_MODULE[path]) return PATH_MODULE[path];
  for (const [prefix, mod] of Object.entries(PATH_MODULE)) {
    if (prefix !== '/' && path.startsWith(`${prefix}/`)) return mod;
  }
  return null;
}

export function isPathAllowedForCompany(userOrCompany, pathname) {
  if (userOrCompany?.role === 'platform_admin') return true;
  const mod = moduleForPath(pathname);
  return isModuleEnabled(userOrCompany, mod);
}
