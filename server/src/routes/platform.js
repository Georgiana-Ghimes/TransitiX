import { Router } from 'express';
import { query, pool } from '../db.js';
import {
  authRequired,
  platformAdminRequired,
  signAccessToken,
  signRefreshToken,
} from '../middleware/auth.js';
import { ensurePlatformCompany } from '../lib/platform/company.js';
import { ensureProductCompanies } from '../lib/platform/ensureProductCompanies.js';
import { isValidSlug, normalizeSlug } from '../lib/platform/slug.js';
import { durationMs, newSessionId, recordSession } from '../lib/sessions.js';
import { ipFrom, recordAudit } from '../lib/audit/events.js';

const router = Router();

router.use(authRequired, platformAdminRequired);

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.slug, c.cui, c.email, c.phone, c.address,
         c.feature_flags, c.created_at, c.updated_at,
         (SELECT count(*)::int FROM users u
           WHERE u.company_id = c.id AND u.is_active = TRUE) AS active_users
  FROM companies c
  WHERE c.is_platform = FALSE
`;

/** Who am I, on the platform side. */
router.get('/me', async (req, res) => {
  try {
    const platform = await ensurePlatformCompany(query);
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        company_id: req.user.company_id,
      },
      platform_company_id: platform.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Platform me failed' });
  }
});

/**
 * Customer tenants only (never the internal platform company).
 * Pass ?ensure_apps=1 once to materialize TMS full + documents companion rows.
 */
router.get('/companies', async (req, res) => {
  try {
    if (String(req.query.ensure_apps || '') === '1') {
      await ensureProductCompanies(query);
    }
    const result = await query(`${COMPANY_SELECT} ORDER BY c.created_at ASC`);
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list companies' });
  }
});

/** Create / refresh the two product company rows (idempotent). */
router.post('/apps/ensure', async (_req, res) => {
  try {
    const result = await ensureProductCompanies(query);
    const list = await query(`${COMPANY_SELECT} ORDER BY c.created_at ASC`);
    res.json({ ...result, items: list.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to ensure product apps' });
  }
});

router.get('/companies/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const result = await query(`${COMPANY_SELECT} AND c.id = $1`, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Company not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load company' });
  }
});

/**
 * Enter a customer company as its office admin (impersonation).
 * Client should stash GOD tokens, then replace with the returned pair.
 */
router.post('/companies/:id/impersonate', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing company id' });

    const companyRes = await query(
      `SELECT id, name, slug, is_platform FROM companies WHERE id = $1 LIMIT 1`,
      [id],
    );
    const company = companyRes.rows[0];
    if (!company || company.is_platform) {
      return res.status(404).json({ message: 'Company not found' });
    }
    if (!company.slug) {
      return res.status(400).json({ message: 'Company has no public slug yet' });
    }

    const adminRes = await query(
      `SELECT * FROM users
       WHERE company_id = $1 AND role = 'admin' AND is_active = TRUE
       ORDER BY created_at ASC
       LIMIT 1`,
      [id],
    );
    const admin = adminRes.rows[0];
    if (!admin) {
      return res.status(404).json({
        message: 'Niciun admin activ pe această firmă. Creează un cont admin înainte.',
      });
    }

    const jti = newSessionId();
    await recordSession({
      jti,
      userId: admin.id,
      companyId: admin.company_id,
      userAgent: req.headers['user-agent'],
      ttlMs: durationMs(process.env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000),
    });

    const extras = {
      impersonator_id: req.user.id,
      impersonator_email: req.user.email,
    };
    const tokens = {
      access_token: signAccessToken(admin, extras),
      refresh_token: signRefreshToken(admin, jti),
    };

    try {
      await recordAudit(pool, {
        company_id: company.id,
        user_id: req.user.id,
        user_name: null,
        user_email: req.user.email,
        user_role: 'platform_admin',
        action: 'impersonate_start',
        entity: 'Company',
        entity_id: company.id,
        label: company.name,
        detail: {
          target_user_id: admin.id,
          target_email: admin.email,
          slug: company.slug,
        },
        ip: ipFrom(req),
      });
    } catch (err) {
      console.error('[audit] impersonate_start', err.message);
    }

    res.json({
      ...tokens,
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
      },
      as_user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        name: admin.name,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Impersonation failed' });
  }
});

/** Replace feature_flags entirely (so toggles can turn modules off). */
router.put('/companies/:id/feature-flags', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const flags = req.body?.feature_flags;
    if (!id) return res.status(400).json({ message: 'Missing company id' });
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
      return res.status(400).json({ message: 'feature_flags must be an object' });
    }

    const result = await query(
      `UPDATE companies
       SET feature_flags = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1 AND is_platform = FALSE
       RETURNING id, name, slug, feature_flags`,
      [id, JSON.stringify(flags)],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Company not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to update feature flags' });
  }
});

/** Patch company profile fields + optional feature_flags replace. */
router.patch('/companies/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing company id' });

    const body = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;

    for (const key of ['name', 'cui', 'email', 'phone', 'address']) {
      if (body[key] === undefined) continue;
      fields.push(`${key} = $${i++}`);
      values.push(body[key] == null ? null : String(body[key]).trim());
    }

    if (body.slug !== undefined) {
      const slug = normalizeSlug(body.slug);
      if (!isValidSlug(slug)) {
        return res.status(400).json({ message: 'Slug invalid (8–24 caractere alfanumerice).' });
      }
      fields.push(`slug = $${i++}`);
      values.push(slug);
    }

    if (body.feature_flags !== undefined) {
      if (!body.feature_flags || typeof body.feature_flags !== 'object' || Array.isArray(body.feature_flags)) {
        return res.status(400).json({ message: 'feature_flags must be an object' });
      }
      fields.push(`feature_flags = $${i++}`);
      values.push(JSON.stringify(body.feature_flags));
    }

    if (!fields.length) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await query(
      `UPDATE companies
       SET ${fields.join(', ')}
       WHERE id = $${i} AND is_platform = FALSE
       RETURNING id, name, slug, cui, email, phone, address, feature_flags, created_at, updated_at`,
      values,
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const withCount = await query(`${COMPANY_SELECT} AND c.id = $1`, [id]);
    res.json(withCount.rows[0] || result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ message: 'Slug-ul este deja folosit.' });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to update company' });
  }
});

export default router;
