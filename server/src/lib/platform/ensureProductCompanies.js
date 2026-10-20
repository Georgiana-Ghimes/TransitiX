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
 * Idempotent — keyed by feature_flags.app_key, preferring the fixed product slug.
 * Never steals a slug owned by another company.
 * Also repairs customer rows that wrongly reused a product app_key.
 */
export async function ensureProductCompanies(queryFn) {
  const created = [];
  const updated = [];

  // Customer companies must not share product catalog app_keys (breaks slug sync).
  await queryFn(
    `UPDATE companies c
     SET feature_flags = jsonb_set(
           jsonb_set(
             COALESCE(c.feature_flags, '{}'::jsonb),
             '{app_key}',
             to_jsonb('tenant_' || c.slug)
           ),
           '{portal_url}',
           to_jsonb('/' || c.slug)
         ),
         updated_at = NOW()
     WHERE c.is_platform = FALSE
       AND c.slug IS NOT NULL
       AND c.feature_flags->>'app_key' IN ('transitix_full', 'rai_documents')
       AND c.slug <> ALL($1::text[])`,
    [Object.values(PRODUCT_SLUGS)],
  );

  for (const profile of Object.values(PRODUCT_APPS)) {
    const slug = profile.slug;
    const bySlug = await queryFn(
      `SELECT id, name, slug, feature_flags
       FROM companies
       WHERE is_platform = FALSE AND slug = $1
       LIMIT 1`,
      [slug],
    );
    const byAppKey = await queryFn(
      `SELECT id, name, slug, feature_flags
       FROM companies
       WHERE is_platform = FALSE
         AND feature_flags->>'app_key' = $1
       ORDER BY CASE WHEN slug = $2 THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [profile.appKey, slug],
    );

    // Prefer the row that already owns the product slug; else the canonical app_key row.
    const existing = bySlug.rows[0] || byAppKey.rows[0] || null;
    const prevFlags = existing?.feature_flags || {};
    const flags = {
      app_key: profile.appKey,
      app_profile: profile.key,
      portal_url: `/${slug}`,
      modules: mergeModules(profile.key, prevFlags.modules),
    };

    if (existing) {
      // Only set the product slug if free or already ours.
      const slugOwner = bySlug.rows[0];
      const canTakeSlug = !slugOwner || slugOwner.id === existing.id;
      if (canTakeSlug) {
        await queryFn(
          `UPDATE companies
           SET feature_flags = $2::jsonb,
               slug = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [existing.id, JSON.stringify(flags), slug],
        );
      } else {
        await queryFn(
          `UPDATE companies
           SET feature_flags = $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [existing.id, JSON.stringify({ ...flags, portal_url: existing.slug ? `/${existing.slug}` : flags.portal_url })],
        );
      }
      updated.push({
        id: existing.id,
        app_key: profile.appKey,
        slug: canTakeSlug ? slug : existing.slug,
        name: existing.name,
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
        const clash = await queryFn(
          `SELECT id FROM companies WHERE slug = $1 AND id <> $2 LIMIT 1`,
          [slug, demo.rows[0].id],
        );
        if (!clash.rows[0]) {
          await queryFn(
            `UPDATE companies
             SET feature_flags = $2::jsonb,
                 slug = $3,
                 updated_at = NOW()
             WHERE id = $1`,
            [demo.rows[0].id, JSON.stringify(demoFlags), slug],
          );
        } else {
          await queryFn(
            `UPDATE companies
             SET feature_flags = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [demo.rows[0].id, JSON.stringify(demoFlags)],
          );
        }
        updated.push({
          id: demo.rows[0].id,
          app_key: profile.appKey,
          slug: clash.rows[0] ? demo.rows[0].slug : slug,
          name: demo.rows[0].name,
        });
        continue;
      }
    }

    const slugTaken = await queryFn(
      `SELECT id FROM companies WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (slugTaken.rows[0]) {
      // Another tenant holds the slug without matching lookup — adopt flags on that row.
      await queryFn(
        `UPDATE companies
         SET feature_flags = $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [slugTaken.rows[0].id, JSON.stringify(flags)],
      );
      updated.push({
        id: slugTaken.rows[0].id,
        app_key: profile.appKey,
        slug,
        name: null,
      });
      continue;
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
