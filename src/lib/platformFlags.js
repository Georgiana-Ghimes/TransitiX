/**
 * Platform catalog: the two product surfaces we sell / host.
 * Stored on companies.feature_flags — consumed later by the tenant UI.
 *
 * Every company (RAI, future tenants) gets the full TMS module list.
 * What the product doesn't use yet stays `false` — not omitted.
 */

export const APP_PROFILES = {
  full: {
    key: 'full',
    appKey: 'transitix_full',
    label: 'Transitix TMS',
    shortLabel: 'TMS full',
    description: 'Platforma completă: dispecerat, flotă, curse, GPS, financiar, avize.',
    defaultPortalUrl: '/txdemo7k2m',
    defaultName: 'Transitix Demo',
    defaultCui: 'RO12345678',
  },
  documents: {
    key: 'documents',
    appKey: 'rai_documents',
    label: 'RAI Spedition — Documente',
    shortLabel: 'Companion documente',
    description: 'Companion slim: avize, rapoarte, upload șofer. Restul modulelor TMS există ca flag, dar off.',
    defaultPortalUrl: '/raidocs4n9p',
    defaultName: 'RAI Spedition — Documente',
    defaultCui: 'RO-RAI-DOCS',
  },
};

/** Full TMS module catalog — shown for every company in platform setup. */
export const MODULE_FLAGS = [
  { key: 'avize', label: 'Avize / Rapoarte', defaultOn: ['full', 'documents'] },
  { key: 'reports', label: 'Rapoarte', defaultOn: ['full', 'documents'] },
  { key: 'driver_upload', label: 'Upload documente șofer', defaultOn: ['full', 'documents'] },
  { key: 'dispatch', label: 'Dispecerat', defaultOn: ['full'] },
  { key: 'trips', label: 'Curse / CMR', defaultOn: ['full'] },
  { key: 'fleet', label: 'Flotă & șoferi', defaultOn: ['full'] },
  { key: 'gps', label: 'Tracking GPS', defaultOn: ['full'] },
  { key: 'planning', label: 'Planning / optimizare', defaultOn: ['full'] },
  { key: 'finance', label: 'Financiar', defaultOn: ['full'] },
  { key: 'warehouse', label: 'Depozit', defaultOn: ['full'] },
  { key: 'documents_expiry', label: 'Documente expirare', defaultOn: ['full'] },
  { key: 'locations', label: 'Locații / geocodare', defaultOn: ['full'] },
  { key: 'territories', label: 'Teritorii', defaultOn: ['full'] },
  { key: 'loading', label: 'Plan încărcare', defaultOn: ['full'] },
  { key: 'commercial', label: 'Comercial / tarife', defaultOn: ['full'] },
  { key: 'audit', label: 'Jurnal modificări', defaultOn: ['full'] },
  { key: 'users_admin', label: 'Administrare utilizatori', defaultOn: ['full'] },
];

export function defaultModulesForProfile(profile = 'full') {
  const prof = profile === 'documents' ? 'documents' : 'full';
  const modules = {};
  for (const m of MODULE_FLAGS) {
    modules[m.key] = m.defaultOn.includes(prof);
  }
  return modules;
}

/**
 * Always materializes every TMS module key.
 * Explicit `false` in stored flags stays off; missing keys fall back to profile defaults.
 */
export function normalizeFlags(raw, profile = 'full') {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const prof = src.app_profile === 'documents' ? 'documents' : (profile === 'documents' ? 'documents' : 'full');
  const meta = APP_PROFILES[prof];
  const modulesIn = src.modules && typeof src.modules === 'object' ? src.modules : {};
  const defaults = defaultModulesForProfile(prof);
  const modules = {};
  for (const m of MODULE_FLAGS) {
    if (Object.prototype.hasOwnProperty.call(modulesIn, m.key)) {
      modules[m.key] = modulesIn[m.key] !== false && modulesIn[m.key] !== 'false' && modulesIn[m.key] !== 0;
    } else {
      modules[m.key] = defaults[m.key];
    }
  }
  return {
    app_key: src.app_key || meta.appKey,
    app_profile: prof,
    portal_url: String(src.portal_url || meta.defaultPortalUrl).trim(),
    modules,
  };
}

export function profileLabel(flags) {
  const p = flags?.app_profile === 'documents' ? 'documents' : 'full';
  return APP_PROFILES[p].shortLabel;
}
