import { Router } from 'express';
import { query, pool, withTransaction } from '../db.js';
import {
  authRequired,
  platformAdminRequired,
  signAccessToken,
  signRefreshToken,
} from '../middleware/auth.js';
import { ensurePlatformCompany } from '../lib/platform/company.js';
import {
  ensureProductCompanies,
  mergeModules,
} from '../lib/platform/ensureProductCompanies.js';
import { allocateUniqueSlug, tenantAppKey } from '../lib/platform/slug.js';
import { durationMs, newSessionId, recordSession } from '../lib/sessions.js';
import { ipFrom, recordAudit } from '../lib/audit/events.js';
import { emailConfigured } from '../lib/email.js';
import { inviteState, normaliseEmail, validateInvite, checkActivate, checkDeactivate } from '../lib/users/rules.js';
import {
  INVITE_TTL_HOURS,
  buildInviteLink,
  deliverInvite,
  hashUnusablePassword,
  newInviteToken,
} from '../lib/users/invite.js';
import { revokeAllForUser } from '../lib/sessions.js';

const router = Router();

router.use(authRequired, platformAdminRequired);

const COMPANY_SELECT = `
  SELECT c.id, c.name, c.slug, c.cui, c.email, c.phone, c.address,
         c.feature_flags, c.created_at, c.updated_at,
         (SELECT count(*)::int FROM users u
           WHERE u.company_id = c.id
             AND u.is_active = TRUE
             AND u.last_login IS NOT NULL) AS active_users,
         (SELECT count(*)::int FROM users u
           WHERE u.company_id = c.id
             AND u.is_active = TRUE
             AND u.last_login IS NULL
             AND u.reset_token IS NOT NULL
             AND u.reset_token_expires_at > NOW()) AS invited_users
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
      if (!String(body.slug || '').trim()) {
        return res.status(400).json({ message: 'Slug-ul nu poate fi gol.' });
      }
      let slug;
      try {
        slug = await allocateUniqueSlug(query, {
          preferred: body.slug,
          excludeCompanyId: id,
        });
      } catch (err) {
        if (err?.status) return res.status(err.status).json({ message: err.message });
        throw err;
      }
      fields.push(`slug = $${i++}`);
      values.push(slug);

      // Merge portal_url / tenant app_key into whichever feature_flags payload we write
      // (never SET feature_flags twice in one UPDATE — Postgres rejects that).
      const current = await query(
        `SELECT feature_flags FROM companies WHERE id = $1 AND is_platform = FALSE`,
        [id],
      );
      const prev = current.rows[0]?.feature_flags || {};
      const baseFlags = (body.feature_flags && typeof body.feature_flags === 'object' && !Array.isArray(body.feature_flags))
        ? body.feature_flags
        : prev;
      body.feature_flags = {
        ...baseFlags,
        portal_url: `/${slug}`,
        app_key: String(baseFlags.app_key || prev.app_key || '').startsWith('tenant_')
          || !baseFlags.app_key
          ? tenantAppKey(slug)
          : (baseFlags.app_key || prev.app_key),
      };
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

const LEAD_STATUSES = new Set(['new', 'contacted', 'converted', 'dismissed']);

function serializePlatformUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    is_active: row.is_active,
    last_login: row.last_login,
    created_at: row.created_at,
    state: inviteState(row),
  };
}

async function allocateSlug(preferred, excludeCompanyId = null) {
  return allocateUniqueSlug(query, {
    preferred: preferred || undefined,
    excludeCompanyId: excludeCompanyId || undefined,
  });
}

function flagsForNewCompany(appProfile, slug) {
  const profileKey = appProfile === 'documents' ? 'documents' : 'full';
  return {
    app_key: tenantAppKey(slug),
    app_profile: profileKey,
    portal_url: `/${slug}`,
    modules: mergeModules(profileKey, {}),
  };
}

/** Access leads from the public „Solicită acces” form. */
router.get('/leads', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const params = [];
    let where = '';
    if (status && LEAD_STATUSES.has(status)) {
      params.push(status);
      where = `WHERE status = $1`;
    }
    const result = await query(
      `SELECT id, company_name, contact_name, email, phone, message,
              preferred_profile, status, notes, converted_company_id,
              created_at, updated_at
       FROM access_leads
       ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list leads' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;

    if (body.status !== undefined) {
      const status = String(body.status || '').trim();
      if (!LEAD_STATUSES.has(status)) {
        return res.status(400).json({ message: 'Status invalid.' });
      }
      fields.push(`status = $${i++}`);
      values.push(status);
    }
    if (body.notes !== undefined) {
      fields.push(`notes = $${i++}`);
      values.push(body.notes == null ? null : String(body.notes));
    }
    if (body.converted_company_id !== undefined) {
      fields.push(`converted_company_id = $${i++}`);
      values.push(body.converted_company_id || null);
    }
    if (!fields.length) {
      return res.status(400).json({ message: 'Nothing to update' });
    }
    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await query(
      `UPDATE access_leads SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING id, company_name, contact_name, email, phone, message,
                 preferred_profile, status, notes, converted_company_id,
                 created_at, updated_at`,
      values,
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Lead not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to update lead' });
  }
});

/**
 * Create a customer company + first admin (invite).
 * Body: name, app_profile, admin_name, admin_email, optional slug/cui/email/phone/address, optional lead_id.
 */
router.post('/companies', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const adminName = String(body.admin_name || '').trim();
    const adminEmail = normaliseEmail(body.admin_email);
    const appProfile = body.app_profile === 'documents' ? 'documents' : 'full';

    if (name.length < 2) {
      return res.status(400).json({ message: 'Numele firmei este obligatoriu.' });
    }
    const inviteCheck = validateInvite({ name: adminName, email: adminEmail, role: 'admin' });
    if (!inviteCheck.ok) {
      return res.status(400).json({ message: inviteCheck.errors.join(' ') });
    }

    const existingUser = await query(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [inviteCheck.value.email],
    );
    if (existingUser.rows[0]) {
      return res.status(409).json({ message: 'Există deja un cont cu acest email pe platformă.' });
    }

    // Public path is always allocated — do not accept client-invented slugs on create.
    // (Rename later via PATCH on the company page if needed.)
    const slug = await allocateSlug(null);
    const flags = flagsForNewCompany(appProfile, slug);

    const token = newInviteToken();
    const password_hash = await hashUnusablePassword();

    const created = await withTransaction(async (client) => {
      const company = await client.query(
        `INSERT INTO companies (name, cui, email, phone, address, is_platform, slug, feature_flags, settings)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7::jsonb, '{}'::jsonb)
         RETURNING id, name, slug, cui, email, phone, address, feature_flags, created_at, updated_at`,
        [
          name,
          body.cui == null ? null : String(body.cui).trim() || null,
          body.email == null ? inviteCheck.value.email : String(body.email).trim() || null,
          body.phone == null ? null : String(body.phone).trim() || null,
          body.address == null ? null : String(body.address).trim() || null,
          slug,
          JSON.stringify(flags),
        ],
      );

      const admin = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role,
                            reset_token, reset_token_expires_at)
         VALUES ($1, $2, $3, $4, 'admin', $5, NOW() + ($6::int || ' hours')::interval)
         RETURNING *`,
        [
          company.rows[0].id,
          inviteCheck.value.name,
          inviteCheck.value.email,
          password_hash,
          token,
          INVITE_TTL_HOURS,
        ],
      );

      const leadId = body.lead_id ? String(body.lead_id).trim() : '';
      if (leadId) {
        await client.query(
          `UPDATE access_leads
           SET status = 'converted',
               converted_company_id = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [leadId, company.rows[0].id],
        );
      }

      return { company: company.rows[0], admin: admin.rows[0] };
    });

    const invite_link = buildInviteLink(req, token);
    const email_sent = await deliverInvite({
      to: inviteCheck.value.email,
      name: inviteCheck.value.name,
      link: invite_link,
      companyName: name,
    });

    try {
      await recordAudit(pool, {
        company_id: created.company.id,
        user_id: req.user.id,
        user_email: req.user.email,
        user_role: 'platform_admin',
        action: 'create',
        entity: 'Company',
        entity_id: created.company.id,
        label: created.company.name,
        detail: { admin_email: inviteCheck.value.email, slug },
        ip: ipFrom(req),
      });
    } catch (err) {
      console.error('[audit] platform create company', err.message);
    }

    const withCount = await query(`${COMPANY_SELECT} AND c.id = $1`, [created.company.id]);
    res.status(201).json({
      company: withCount.rows[0] || created.company,
      admin: serializePlatformUser(created.admin),
      email_sent,
      invite_link: email_sent ? undefined : invite_link,
      email_configured: emailConfigured(),
    });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ message: err.message });
    if (err?.code === '23505') {
      return res.status(409).json({ message: 'Slug-ul sau emailul este deja folosit.' });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to create company' });
  }
});

router.get('/companies/:id/users', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const company = await query(
      `SELECT id, name FROM companies WHERE id = $1 AND is_platform = FALSE`,
      [id],
    );
    if (!company.rows[0]) return res.status(404).json({ message: 'Company not found' });

    const rows = await query(
      `SELECT * FROM users
       WHERE company_id = $1
       ORDER BY is_active DESC, role, LOWER(name)`,
      [id],
    );
    res.json({
      items: rows.rows.map(serializePlatformUser),
      email_configured: emailConfigured(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list users' });
  }
});

router.post('/companies/:id/users/invite', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const company = await query(
      `SELECT id, name, slug FROM companies WHERE id = $1 AND is_platform = FALSE`,
      [id],
    );
    if (!company.rows[0]) return res.status(404).json({ message: 'Company not found' });

    const check = validateInvite(req.body || {});
    if (!check.ok) return res.status(400).json({ message: check.errors.join(' ') });
    const { name, email, role } = check.value;

    const existing = await query(
      `SELECT id, company_id, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].company_id === id) {
        return res.status(409).json({
          message: existing.rows[0].is_active
            ? 'Există deja un cont cu acest email pe firmă.'
            : 'Există un cont dezactivat cu acest email pe firmă.',
        });
      }
      return res.status(409).json({ message: 'Emailul este deja folosit pe altă firmă.' });
    }

    const token = newInviteToken();
    const password_hash = await hashUnusablePassword();
    const created = (await query(
      `INSERT INTO users (company_id, name, email, password_hash, role, phone,
                          reset_token, reset_token_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + ($8::int || ' hours')::interval)
       RETURNING *`,
      [
        id,
        name,
        email,
        password_hash,
        role,
        String(req.body?.phone || '').trim() || null,
        token,
        INVITE_TTL_HOURS,
      ],
    )).rows[0];

    if (role === 'driver') {
      await query(
        `UPDATE drivers SET user_id = $1, updated_at = NOW()
         WHERE company_id = $2 AND user_id IS NULL AND LOWER(email) = $3`,
        [created.id, id, email],
      );
    }

    const invite_link = buildInviteLink(req, token);
    const email_sent = await deliverInvite({
      to: email,
      name,
      link: invite_link,
      companyName: company.rows[0].name,
    });

    try {
      await recordAudit(pool, {
        company_id: id,
        user_id: req.user.id,
        user_email: req.user.email,
        user_role: 'platform_admin',
        action: 'create',
        entity: 'User',
        entity_id: created.id,
        label: email,
        detail: { role, via: 'platform_invite' },
        ip: ipFrom(req),
      });
    } catch (err) {
      console.error('[audit] platform invite', err.message);
    }

    res.status(201).json({
      user: serializePlatformUser(created),
      email_sent,
      invite_link: email_sent ? undefined : invite_link,
      email_configured: emailConfigured(),
    });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ message: 'Există deja un cont cu acest email.' });
    }
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to invite user' });
  }
});

/** Dashboard counters for GOD landing. */
router.get('/stats', async (_req, res) => {
  try {
    const [companies, leadsNew, usersActive, usersInvited] = await Promise.all([
      query(`SELECT count(*)::int AS c FROM companies WHERE is_platform = FALSE`),
      query(`SELECT count(*)::int AS c FROM access_leads WHERE status = 'new'`),
      query(
        `SELECT count(*)::int AS c FROM users u
         JOIN companies c ON c.id = u.company_id
         WHERE u.is_active = TRUE
           AND c.is_platform = FALSE
           AND u.last_login IS NOT NULL`,
      ),
      query(
        `SELECT count(*)::int AS c FROM users u
         JOIN companies c ON c.id = u.company_id
         WHERE u.is_active = TRUE
           AND c.is_platform = FALSE
           AND u.last_login IS NULL
           AND u.reset_token IS NOT NULL
           AND u.reset_token_expires_at > NOW()`,
      ),
    ]);
    res.json({
      companies: companies.rows[0].c,
      leads_new: leadsNew.rows[0].c,
      users_active: usersActive.rows[0].c,
      users_invited: usersInvited.rows[0].c,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to load stats' });
  }
});

/**
 * Cross-tenant user directory (platform GOD only).
 * Optional ?q= filters name/email/company; ?company_id= scopes to one firm.
 */
router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const companyId = String(req.query.company_id || '').trim();
    const params = [];
    const where = [`c.is_platform = FALSE`];

    if (companyId) {
      params.push(companyId);
      where.push(`u.company_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(
        LOWER(u.email) LIKE $${i}
        OR LOWER(u.name) LIKE $${i}
        OR LOWER(c.name) LIKE $${i}
        OR LOWER(COALESCE(c.slug, '')) LIKE $${i}
      )`);
    }

    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.is_active, u.last_login, u.created_at,
              u.reset_token, u.reset_token_expires_at,
              c.id AS company_id, c.name AS company_name, c.slug AS company_slug,
              c.feature_flags->>'app_profile' AS company_profile
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY LOWER(c.name), u.is_active DESC, u.role, LOWER(u.name)
       LIMIT 500`,
      params,
    );

    res.json({
      items: result.rows.map((row) => ({
        ...serializePlatformUser(row),
        company: {
          id: row.company_id,
          name: row.company_name,
          slug: row.company_slug,
          app_profile: row.company_profile === 'documents' ? 'documents' : 'full',
        },
      })),
      email_configured: emailConfigured(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to list users' });
  }
});

async function loadPlatformTargetUser(userId) {
  const result = await query(
    `SELECT u.*, c.id AS company_id, c.name AS company_name, c.slug AS company_slug, c.is_platform
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function activeAdminCountForCompany(companyId) {
  const res = await query(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE company_id = $1 AND role = 'admin' AND is_active = TRUE`,
    [companyId],
  );
  return res.rows[0].c;
}

/** Block / unblock a tenant user (not platform_admin). */
router.put('/users/:userId/active', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const target = await loadPlatformTargetUser(userId);
    if (!target || target.is_platform || target.role === 'platform_admin') {
      return res.status(404).json({ message: 'Utilizator inexistent.' });
    }

    const wanted = req.body?.is_active === true;
    const adminCount = await activeAdminCountForCompany(target.company_id);
    const verdict = wanted
      ? checkActivate({ target })
      : checkDeactivate({
        actorId: req.user.id,
        target,
        adminCount,
      });
    if (!verdict.ok) return res.status(422).json({ message: verdict.reason });

    await query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [wanted, target.id],
    );

    let revoked = 0;
    if (!wanted) revoked = await revokeAllForUser(target.id);

    try {
      await recordAudit(pool, {
        company_id: target.company_id,
        user_id: req.user.id,
        user_email: req.user.email,
        user_role: 'platform_admin',
        action: 'update',
        entity: 'User',
        entity_id: target.id,
        label: target.email,
        detail: { is_active: wanted, sessions_revoked: revoked, via: 'platform' },
        ip: ipFrom(req),
      });
    } catch (err) {
      console.error('[audit] platform user active', err.message);
    }

    const fresh = await loadPlatformTargetUser(target.id);
    res.json({
      user: {
        ...serializePlatformUser(fresh),
        company: {
          id: fresh.company_id,
          name: fresh.company_name,
          slug: fresh.company_slug,
        },
      },
      sessions_revoked: revoked,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to update user' });
  }
});

/**
 * Force a password reset / re-invite link (stub returns invite_link when Resend is off).
 * Revokes sessions so the old password session cannot linger after GOD intervention.
 */
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const target = await loadPlatformTargetUser(userId);
    if (!target || target.is_platform || target.role === 'platform_admin') {
      return res.status(404).json({ message: 'Utilizator inexistent.' });
    }
    if (!target.is_active) {
      return res.status(422).json({ message: 'Contul este blocat. Reactivează-l înainte de reset.' });
    }

    const token = newInviteToken();
    await query(
      `UPDATE users SET reset_token = $1,
              reset_token_expires_at = NOW() + ($2::int || ' hours')::interval,
              updated_at = NOW()
       WHERE id = $3`,
      [token, INVITE_TTL_HOURS, target.id],
    );

    const revoked = await revokeAllForUser(target.id);
    const invite_link = buildInviteLink(req, token);
    const email_sent = await deliverInvite({
      to: target.email,
      name: target.name,
      link: invite_link,
      companyName: target.company_name,
    });

    try {
      await recordAudit(pool, {
        company_id: target.company_id,
        user_id: req.user.id,
        user_email: req.user.email,
        user_role: 'platform_admin',
        action: 'update',
        entity: 'User',
        entity_id: target.id,
        label: target.email,
        detail: { password_reset: true, sessions_revoked: revoked, via: 'platform' },
        ip: ipFrom(req),
      });
    } catch (err) {
      console.error('[audit] platform reset password', err.message);
    }

    res.json({
      email_sent,
      invite_link: email_sent ? undefined : invite_link,
      email_configured: emailConfigured(),
      sessions_revoked: revoked,
      user: {
        ...serializePlatformUser({ ...target, reset_token: token }),
        company: {
          id: target.company_id,
          name: target.company_name,
          slug: target.company_slug,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to reset password' });
  }
});

export default router;
