import { query } from '../db.js';
import {
  isCompanyModuleEnabled,
  moduleForEntity,
} from '../lib/platform/modules.js';

async function loadCompanyFlags(req) {
  if (req.companyFeatureFlags !== undefined) return req.companyFeatureFlags;
  if (!req.user?.company_id) {
    req.companyFeatureFlags = null;
    return null;
  }
  const result = await query(
    `SELECT feature_flags FROM companies WHERE id = $1 LIMIT 1`,
    [req.user.company_id],
  );
  req.companyFeatureFlags = result.rows[0]?.feature_flags || {};
  return req.companyFeatureFlags;
}

function denyModule(res, moduleKey) {
  return res.status(403).json({
    code: 'MODULE_DISABLED',
    module: moduleKey,
    message: 'Acest modul nu este activat pentru firma ta. Contactează Transitix (panou GOD).',
  });
}

/**
 * After authRequired. Rejects platform_admin on tenant mounts and disabled modules.
 * @param {string|null} moduleKey
 */
export function requireModule(moduleKey) {
  return async (req, res, next) => {
    try {
      if (!moduleKey) return next();
      if (!req.user) {
        return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
      }
      if (req.user.role === 'platform_admin') {
        return res.status(403).json({
          message: 'Contul de platformă nu folosește API-ul unui tenant. Folosește /api/platform.',
        });
      }
      const flags = await loadCompanyFlags(req);
      if (!isCompanyModuleEnabled(flags, moduleKey)) {
        return denyModule(res, moduleKey);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** For /api/entities/:entity — resolves module from entity name (string or OR-list). */
export function requireEntityModule(req, res, next) {
  const entity = String(req.params.entity || '');
  const moduleKey = moduleForEntity(entity);
  if (Array.isArray(moduleKey)) {
    return requireAnyModule(...moduleKey)(req, res, next);
  }
  return requireModule(moduleKey)(req, res, next);
}

/** Allow if any listed module is on (e.g. zone APIs shared by Harta zonelor + Comercial). */
export function requireAnyModule(...moduleKeys) {
  const keys = moduleKeys.filter(Boolean);
  return async (req, res, next) => {
    try {
      if (!keys.length) return next();
      if (!req.user) {
        return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
      }
      if (req.user.role === 'platform_admin') {
        return res.status(403).json({
          message: 'Contul de platformă nu folosește API-ul unui tenant. Folosește /api/platform.',
        });
      }
      const flags = await loadCompanyFlags(req);
      if (keys.some((k) => isCompanyModuleEnabled(flags, k))) {
        return next();
      }
      return denyModule(res, keys[0]);
    } catch (err) {
      return next(err);
    }
  };
}
