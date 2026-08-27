/**
 * Administering the people who use the system.
 *
 * Everything here used to be an `INSERT` typed by whoever had database access. Three routes out
 * of four exist because of what that implied: an invitation so nobody sets somebody else's
 * password, deactivation so nobody is deleted, and a role change that refuses to strip the last
 * administrator.
 *
 * Admin-only throughout, and every write is recorded on the audit trail — a screen that can hand
 * out administrator rights and leave no trace would undo the point of having a trail at all.
 */
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, query } from '../db.js';
import { authRequired, officeRequired, adminRequired } from '../middleware/auth.js';
import { sendEmail, emailConfigured } from '../lib/email.js';
import { revokeAllForUser } from '../lib/sessions.js';
import { actorFrom, recordAudit } from '../lib/audit/events.js';
import {
  INVITE_TTL_HOURS,
  ROLES,
  checkActivate,
  checkDeactivate,
  checkRoleChange,
  driverReady,
  inviteState,
  unusablePasswordSeed,
  validateInvite,
} from '../lib/users/rules.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'users' });

const router = Router();
router.use(authRequired, officeRequired, adminRequired);

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err?.message || fallback });
}

/** Never returns password_hash, reset_token or the 2FA secret — not even to an admin. */
function serializeUser(row) {
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
    driver_id: row.driver_id || null,
    driver_name: row.driver_name || null,
    driver_ready: driverReady(row),
    active_sessions: row.active_sessions ?? 0,
    // Null for every account that predates the invitation screen — including the founder's.
    invited_by: row.invited_by_name || row.invited_by_email || null,
    invited_at: row.invited_at || null,
  };
}

/** Active administrators, for the two rules that depend on there being another one. */
async function activeAdminCount(companyId) {
  const res = await query(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE company_id = $1 AND role = 'admin' AND is_active = TRUE`,
    [companyId]
  );
  return res.rows[0].c;
}

async function loadUser(companyId, id) {
  const res = await query(
    `SELECT u.*, d.id AS driver_id, d.name AS driver_name
     FROM users u
     LEFT JOIN drivers d ON d.user_id = u.id AND d.company_id = u.company_id
     WHERE u.id = $1 AND u.company_id = $2`,
    [id, companyId]
  );
  return res.rows[0] || null;
}

/** Records a change to an account. The redaction pattern keeps the hash out by itself. */
async function auditUser(req, { action, target, changes = null, detail = null }) {
  try {
    await recordAudit(pool, {
      company_id: req.user.company_id,
      action,
      entity: 'User',
      entity_id: target?.id ?? null,
      label: target?.email || target?.name || null,
      changes,
      detail,
      ...actorFrom(req),
    });
  } catch (err) {
    // The account change already happened; failing the request now would misreport it.
    log.error('nu am putut înregistra schimbarea de cont', err, { action });
  }
}

/**
 * Everyone in the company, with the two things the columns do not say: whether an invitation is
 * still outstanding, and whether a driver account can actually be used.
 */
router.get('/', async (req, res) => {
  try {
    const rows = await query(
      `SELECT u.*, d.id AS driver_id, d.name AS driver_name,
              inviter.name AS invited_by_name, inviter.email AS invited_by_email,
              (SELECT COUNT(*)::int FROM refresh_tokens r
               WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.expires_at > NOW())
                AS active_sessions
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id AND d.company_id = u.company_id
       LEFT JOIN users inviter ON inviter.id = u.invited_by
       WHERE u.company_id = $1
       ORDER BY u.is_active DESC, u.role, LOWER(u.name)`,
      [req.user.company_id]
    );

    // Driver profiles nobody is signed in as — the candidates for linking a driver account.
    const unlinked = await query(
      `SELECT id, name, email FROM drivers
       WHERE company_id = $1 AND user_id IS NULL AND is_active = TRUE
       ORDER BY LOWER(name)`,
      [req.user.company_id]
    );

    res.json({
      users: rows.rows.map(serializeUser),
      roles: ROLES,
      unlinked_drivers: unlinked.rows,
      admin_count: rows.rows.filter((u) => u.role === 'admin' && u.is_active).length,
      email_configured: emailConfigured(),
    });
  } catch (err) {
    fail(res, err, 'Lista de utilizatori nu a putut fi încărcată.');
  }
});

/**
 * Invites somebody.
 *
 * The account is created active but with a password nobody knows; the invitation link is the only
 * way in. Reusing the reset-password flow rather than inventing a second one means there is a
 * single path for "prove it is you, then choose a password".
 */
router.post('/invite', async (req, res) => {
  try {
    const check = validateInvite(req.body || {});
    if (!check.ok) return res.status(400).json({ message: check.errors.join(' ') });
    const { name, email, role } = check.value;

    const existing = await query(
      `SELECT id, is_active FROM users WHERE company_id = $1 AND LOWER(email) = $2`,
      [req.user.company_id, email]
    );
    if (existing.rows[0]) {
      return res.status(409).json({
        message: existing.rows[0].is_active
          ? 'Există deja un cont cu acest email.'
          : 'Există un cont dezactivat cu acest email. Reactivează-l în loc să creezi altul.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    // NOT NULL needs a value, and it must be one nobody can guess or reuse.
    const password_hash = await bcrypt.hash(
      unusablePasswordSeed(crypto.randomBytes(32).toString('hex')), 12
    );

    const created = (await query(
      `INSERT INTO users (company_id, name, email, password_hash, role, phone,
                          reset_token, reset_token_expires_at, invited_by, invited_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + ($8::int || ' hours')::interval, $9, NOW())
       RETURNING *`,
      [req.user.company_id, name, email, password_hash, role,
        String(req.body?.phone || '').trim() || null, token, INVITE_TTL_HOURS, req.user.id]
    )).rows[0];

    // A driver profile already carrying this email is the same person; link it rather than
    // leaving an account that signs in to an empty driver app.
    let linked = null;
    if (role === 'driver') {
      linked = (await query(
        `UPDATE drivers SET user_id = $1, updated_at = NOW()
         WHERE company_id = $2 AND user_id IS NULL AND LOWER(email) = $3
         RETURNING id, name`,
        [created.id, req.user.company_id, email]
      )).rows[0] || null;
    }

    const invite_link = inviteLink(req, token);
    const sent = await deliverInvite({ to: email, name, link: invite_link, company: req.user });

    await auditUser(req, {
      action: 'create',
      target: created,
      changes: { name, email, role, invitat: 'da' },
      detail: linked ? { driver_linked: linked.name } : null,
    });

    res.status(201).json({
      user: serializeUser({ ...created, driver_id: linked?.id, driver_name: linked?.name }),
      email_sent: sent,
      // Without a mail provider the link is the only way to pass the invitation on.
      invite_link: sent ? undefined : invite_link,
    });
  } catch (err) {
    fail(res, err, 'Invitația nu a putut fi trimisă.');
  }
});

/** Issues a fresh link when the first one expired or never arrived. */
router.post('/:id/resend-invite', async (req, res) => {
  try {
    const target = await loadUser(req.user.company_id, req.params.id);
    if (!target) return res.status(404).json({ message: 'Utilizator inexistent.' });
    if (!target.is_active) {
      return res.status(422).json({ message: 'Contul este dezactivat. Reactivează-l întâi.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `UPDATE users SET reset_token = $1,
              reset_token_expires_at = NOW() + ($2::int || ' hours')::interval,
              updated_at = NOW()
       WHERE id = $3 AND company_id = $4`,
      [token, INVITE_TTL_HOURS, target.id, req.user.company_id]
    );

    const invite_link = inviteLink(req, token);
    const sent = await deliverInvite({
      to: target.email, name: target.name, link: invite_link, company: req.user,
    });
    await auditUser(req, { action: 'update', target, changes: { invitatie: { from: null, to: 'retrimisă' } } });

    res.json({ email_sent: sent, invite_link: sent ? undefined : invite_link });
  } catch (err) {
    fail(res, err, 'Invitația nu a putut fi retrimisă.');
  }
});

/** Changes somebody's role, refusing the two changes that cannot be undone from inside. */
router.put('/:id/role', async (req, res) => {
  try {
    const target = await loadUser(req.user.company_id, req.params.id);
    if (!target) return res.status(404).json({ message: 'Utilizator inexistent.' });

    const nextRole = String(req.body?.role || '');
    const verdict = checkRoleChange({
      actorId: req.user.id,
      target,
      nextRole,
      adminCount: await activeAdminCount(req.user.company_id),
    });
    if (!verdict.ok) return res.status(422).json({ message: verdict.reason });

    await query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [nextRole, target.id, req.user.company_id]
    );

    // A role change alters what the token says. Their next request should carry the new one.
    const revoked = await revokeAllForUser(target.id);

    await auditUser(req, {
      action: 'update',
      target,
      changes: { role: { from: target.role, to: nextRole } },
      detail: { sessions_revoked: revoked },
    });

    res.json({ ...serializeUser({ ...target, role: nextRole }), sessions_revoked: revoked });
  } catch (err) {
    fail(res, err, 'Rolul nu a putut fi schimbat.');
  }
});

/**
 * Turns an account off or back on.
 *
 * Deactivation revokes every session, which stops the account being renewed. An access token
 * already issued keeps working until it expires — `JWT_EXPIRES_IN` is that bound, and the
 * response says so rather than letting an admin believe the cut is instant.
 */
router.put('/:id/active', async (req, res) => {
  try {
    const target = await loadUser(req.user.company_id, req.params.id);
    if (!target) return res.status(404).json({ message: 'Utilizator inexistent.' });

    const wanted = req.body?.is_active === true;
    const verdict = wanted
      ? checkActivate({ target })
      : checkDeactivate({
        actorId: req.user.id, target, adminCount: await activeAdminCount(req.user.company_id),
      });
    if (!verdict.ok) return res.status(422).json({ message: verdict.reason });

    await query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [wanted, target.id, req.user.company_id]
    );

    let revoked = 0;
    if (!wanted) revoked = await revokeAllForUser(target.id);

    await auditUser(req, {
      action: 'update',
      target,
      changes: { is_active: { from: target.is_active, to: wanted } },
      detail: revoked ? { sessions_revoked: revoked } : null,
    });

    res.json({
      ...serializeUser({ ...target, is_active: wanted }),
      sessions_revoked: revoked,
      access_token_ttl: process.env.JWT_EXPIRES_IN || '24h',
    });
  } catch (err) {
    fail(res, err, 'Contul nu a putut fi actualizat.');
  }
});

/**
 * Points a driver account at its driver profile.
 *
 * Without it a driver signs in and finds an empty app: trips are resolved through
 * `drivers.user_id`, so the account is correct and useless at the same time.
 */
router.put('/:id/driver', async (req, res) => {
  try {
    const target = await loadUser(req.user.company_id, req.params.id);
    if (!target) return res.status(404).json({ message: 'Utilizator inexistent.' });
    if (target.role !== 'driver') {
      return res.status(422).json({ message: 'Doar un cont cu rol de șofer poate fi legat.' });
    }

    const driverId = req.body?.driver_id ?? null;

    // Always clear the old link first, so a profile is never claimed by two accounts.
    await query(
      `UPDATE drivers SET user_id = NULL, updated_at = NOW()
       WHERE company_id = $1 AND user_id = $2`,
      [req.user.company_id, target.id]
    );

    let linked = null;
    if (driverId) {
      linked = (await query(
        `UPDATE drivers SET user_id = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3 AND (user_id IS NULL OR user_id = $1)
         RETURNING id, name`,
        [target.id, driverId, req.user.company_id]
      )).rows[0] || null;
      if (!linked) {
        return res.status(422).json({ message: 'Profilul de șofer nu există sau e deja legat de alt cont.' });
      }
    }

    await auditUser(req, {
      action: 'update',
      target,
      changes: { profil_sofer: { from: target.driver_name, to: linked?.name ?? null } },
    });

    res.json(serializeUser({ ...target, driver_id: linked?.id ?? null, driver_name: linked?.name ?? null }));
  } catch (err) {
    fail(res, err, 'Profilul de șofer nu a putut fi legat.');
  }
});

function inviteLink(req, token) {
  const origin = req.body?.origin
    || process.env.CLIENT_ORIGIN
    || `${req.protocol}://${req.get('host')}`;
  return `${String(origin).replace(/\/$/, '')}/reset-password?token=${token}`;
}

/**
 * Sends the invitation, reporting whether it actually went.
 *
 * `sendEmail` resolves happily without a mail provider — it logs the message and returns
 * `{ stub: true }`. Reporting that as sent would leave an admin waiting for an email nobody will
 * ever receive, so a stubbed send counts as not sent and the caller hands back the link instead.
 */
async function deliverInvite({ to, name, link }) {
  try {
    const result = await sendEmail({
      to,
      subject: 'Invitație în Transitix',
      text: `Salut, ${name}.\n\nAi fost invitat în Transitix. Alege-ți parola aici (link valabil `
        + `${INVITE_TTL_HOURS / 24} zile):\n${link}\n`,
      html: `<p>Salut, ${name}.</p><p>Ai fost invitat în Transitix. Alege-ți parola aici `
        + `(link valabil ${INVITE_TTL_HOURS / 24} zile):</p><p><a href="${link}">${link}</a></p>`,
    });
    return Boolean(result?.ok && !result.stub);
  } catch (err) {
    // The account exists either way; the admin can pass the link on by hand.
    log.error('invite email', err.message);
    return false;
  }
}

export default router;
