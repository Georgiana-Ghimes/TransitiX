/** Product surfaces hosted on this platform (server-side catalog). */

import { PRODUCT_SLUGS } from './slug.js';

/** Keep in sync with src/lib/platformFlags.js MODULE_FLAGS keys. */
const ALL_MODULE_KEYS = [
  'avize',
  'reports',
  'driver_upload',
  'dispatch',
  'trips',
  'fleet',
  'gps',
  'planning',
  'finance',
  'warehouse',
  'documents_expiry',
  'locations',
  'territories',
  'loading',
  'commercial',
  'audit',
  'users_admin',
];

/** Modules on for the documents companion; everything else stays explicit false. */
const DOCUMENTS_ON = new Set(['avize', 'reports', 'driver_upload']);

function modulesForProfile(profileKey) {
  const modules = {};
  for (const key of ALL_MODULE_KEYS) {
    modules[key] = profileKey === 'full' ? true : DOCUMENTS_ON.has(key);
  }
  return modules;
}

export const PRODUCT_APPS = {
  full: {
    key: 'full',
    appKey: 'transitix_full',
    slug: PRODUCT_SLUGS.transitix_full,
    label: 'Transitix TMS',
    defaultName: 'Transitix Demo',
    defaultCui: 'RO12345678',
    defaultEmail: 'contact@transitix.ro',
    get defaultModules() {
      return modulesForProfile('full');
    },
  },
  documents: {
    key: 'documents',
    appKey: 'rai_documents',
    slug: PRODUCT_SLUGS.rai_documents,
    label: 'RAI Spedition — Documente',
    defaultName: 'RAI Spedition — Documente',
    defaultCui: 'RO-RAI-DOCS',
    defaultEmail: 'documente@rai-spedition.ro',
    get defaultModules() {
      return modulesForProfile('documents');
    },
  },
};

/**
 * Merge stored modules onto the full catalog.
 * - Defaults from profile (RAI → most off)
 * - Existing explicit values win (so an admin who turned something on keeps it)
 * - New catalog keys appear as the profile default (usually false for documents)
 */
export function mergeModules(profileKey, storedModules) {
  const base = modulesForProfile(profileKey);
  const prev = storedModules && typeof storedModules === 'object' ? storedModules : {};
  const out = { ...base };
  for (const key of ALL_MODULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(prev, key)) {
      out[key] = prev[key] !== false && prev[key] !== 'false' && prev[key] !== 0;
    }
  }
  return out;
}

/**
 * Ensure the two product tenants exist (TMS full + documents companion).
 * Idempotent — keyed by feature_flags.app_key. Fixed public slugs.
 */
export async function ensureProductCompanies(queryFn) {
  const created = [];
  const updated = [];

  for (const profile of Object.values(PRODUCT_APPS)) {
    const existing = await queryFn(
      `SELECT id, name, slug, feature_flags
       FROM companies
       WHERE is_platform = FALSE
         AND feature_flags->>'app_key' = $1
       LIMIT 1`,
      [profile.appKey],
    );

    const prevFlags = existing.rows[0]?.feature_flags || {};
    const slug = profile.slug;
    const flags = {
      app_key: profile.appKey,
      app_profile: profile.key,
      // Path on the shared host — no more :5173 vs :5174 portal switching.
      portal_url: `/${slug}`,
      modules: mergeModules(profile.key, prevFlags.modules),
    };

    if (existing.rows[0]) {
      await queryFn(
        `UPDATE companies
         SET feature_flags = $2::jsonb,
             slug = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id, JSON.stringify(flags), slug],
      );
      updated.push({
        id: existing.rows[0].id,
        app_key: profile.appKey,
        slug,
        name: existing.rows[0].name,
      });
      continue;
    }

    if (profile.key === 'full') {
      const demo = await queryFn(
        `SELECT id, name, slug, feature_flags FROM companies
         WHERE is_platform = FALSE
           AND (feature_flags->>'app_key' IS NULL OR feature_flags->>'app_key' = '')
           AND (cui = $1 OR lower(name) LIKE '%transitix%')
         ORDER BY created_at
         LIMIT 1`,
        [profile.defaultCui],
      );
      if (demo.rows[0]) {
        const demoPrev = demo.rows[0].feature_flags || {};
        const demoFlags = {
          ...flags,
          modules: mergeModules('full', demoPrev.modules),
        };
        await queryFn(
          `UPDATE companies
           SET feature_flags = $2::jsonb,
               slug = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [demo.rows[0].id, JSON.stringify(demoFlags), slug],
        );
        updated.push({
          id: demo.rows[0].id,
          app_key: profile.appKey,
          slug,
          name: demo.rows[0].name,
        });
        continue;
      }
    }

    const inserted = await queryFn(
      `INSERT INTO companies (name, cui, email, is_platform, slug, feature_flags, settings)
       VALUES ($1, $2, $3, FALSE, $4, $5::jsonb, '{}'::jsonb)
       RETURNING id, name, slug`,
      [profile.defaultName, profile.defaultCui, profile.defaultEmail, slug, JSON.stringify(flags)],
    );
    created.push({
      id: inserted.rows[0].id,
      app_key: profile.appKey,
      slug: inserted.rows[0].slug,
      name: inserted.rows[0].name,
    });
  }

  return { created, updated };
}
