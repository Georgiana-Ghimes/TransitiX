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
    defaultCui: 'RO-TX-FULL',
  },
  documents: {
    key: 'documents',
    appKey: 'rai_documents',
    label: 'RAI Spedition — Documente',
    shortLabel: 'Companion documente',
    description: 'Companion: avize, rapoarte, flotă/șoferi, upload. Restul TMS există ca flag, dar off.',
    defaultPortalUrl: '/raidocs4n9p',
    defaultName: 'RAI Spedition — Documente',
    defaultCui: 'RO-RAI-DOCS',
  },
};

/** Sidebar / GOD UI sections for MODULE_FLAGS.group */
export const MODULE_GROUPS = [
  {
    id: 'documents',
    label: 'Documente & OCR',
    hint: 'Avize, anexe, hartă zone, upload de pe drum',
  },
  {
    id: 'operations',
    label: 'Operațiuni',
    hint: 'Dispecerat, curse, încărcare, planning',
  },
  {
    id: 'fleet',
    label: 'Flotă & teren',
    hint: 'Mașini, șoferi, GPS, locații',
  },
  {
    id: 'backoffice',
    label: 'Comercial & back-office',
    hint: 'Financiar, depozit, tarife',
  },
  {
    id: 'admin',
    label: 'Administrare',
    hint: 'Conturi și jurnal',
  },
];

/** Full TMS module catalog — shown for every company in platform setup. */
export const MODULE_FLAGS = [
  { key: 'avize', label: 'Avize / Rapoarte', group: 'documents', defaultOn: ['full', 'documents'] },
  { key: 'reports', label: 'Rapoarte', group: 'documents', defaultOn: ['full', 'documents'] },
  { key: 'zone_map', label: 'Harta zonelor', group: 'documents', defaultOn: ['full', 'documents'] },
  { key: 'driver_upload', label: 'Upload documente șofer', group: 'documents', defaultOn: ['full', 'documents'] },
  { key: 'documents_expiry', label: 'Documente expirare', group: 'documents', defaultOn: ['full'] },
  { key: 'dispatch', label: 'Dispecerat', group: 'operations', defaultOn: ['full'] },
  { key: 'trips', label: 'Curse / CMR', group: 'operations', defaultOn: ['full'] },
  { key: 'loading', label: 'Plan încărcare', group: 'operations', defaultOn: ['full'] },
  { key: 'planning', label: 'Planning / optimizare', group: 'operations', defaultOn: ['full'] },
  // Companion office nav includes Autoturisme / ITP / Șoferi (build 128+).
  { key: 'fleet', label: 'Flotă & șoferi', group: 'fleet', defaultOn: ['full', 'documents'] },
  { key: 'gps', label: 'Tracking GPS', group: 'fleet', defaultOn: ['full'] },
  { key: 'locations', label: 'Locații / geocodare', group: 'fleet', defaultOn: ['full'] },
  { key: 'territories', label: 'Teritorii', group: 'fleet', defaultOn: ['full'] },
  { key: 'finance', label: 'Financiar', group: 'backoffice', defaultOn: ['full'] },
  { key: 'warehouse', label: 'Depozit', group: 'backoffice', defaultOn: ['full'] },
  { key: 'commercial', label: 'Comercial / tarife', group: 'backoffice', defaultOn: ['full'] },
  // Companion Setări › Utilizatori — same default as server DOCUMENTS_ON.
  { key: 'users_admin', label: 'Administrare utilizatori', group: 'admin', defaultOn: ['full', 'documents'] },
  { key: 'audit', label: 'Jurnal modificări', group: 'admin', defaultOn: ['full'] },
];

/** Groups with their modules, in display order (for GOD Module tab). */
export function modulesByGroup(modules = MODULE_FLAGS) {
  return MODULE_GROUPS.map((g) => ({
    ...g,
    modules: modules.filter((m) => m.group === g.id),
  })).filter((g) => g.modules.length > 0);
}

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
  let prof = 'full';
  if (src.app_profile === 'documents' || src.app_key === APP_PROFILES.documents.appKey) {
    prof = 'documents';
  } else if (src.app_profile === 'full') {
    prof = 'full';
  } else if (profile === 'documents') {
    prof = 'documents';
  }
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
