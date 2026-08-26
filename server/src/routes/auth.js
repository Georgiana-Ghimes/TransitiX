import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { isPgUniqueViolation } from '../lib/concurrency.js';
import { authRequired, signAccessToken, signRefreshToken } from '../middleware/auth.js';
import { sendEmail, emailConfigured } from '../lib/email.js';
import { rateLimit } from '../lib/rateLimit.js';
import { ipFrom, recordAudit } from '../lib/audit/events.js';
import { pool } from '../db.js';
import {
  durationMs,
  listSessions,
  newSessionId,
  recordSession,
  revokeAllForUser,
  revokeSession,
  sessionUsable,
  touchSession,
} from '../lib/sessions.js';

const router = Router();
const authAttemptLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function publicUser(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    email: row.email,
    full_name: row.name,
    name: row.name,
    role: row.role,
    phone: row.phone,
    is_active: row.is_active,
  };
}


/** Mints a tracked session and returns the pair the client stores. */
async function issueTokens(user, req) {
  const jti = newSessionId();
  await recordSession({
    jti,
    userId: user.id,
    companyId: user.company_id,
    userAgent: req.headers['user-agent'],
    ttlMs: durationMs(process.env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000),
  });
  return { access_token: signAccessToken(user), refresh_token: signRefreshToken(user, jti) };
}

/**
 * Security events, recorded without ever failing the request that produced them.
 *
 * A sign-in that returns 500 because logging it did not work is a worse outcome than a missing
 * line in the trail — so this swallows its own errors and says so in the log instead.
 */
async function auditSecurity(req, { user, action, detail = null }) {
  if (!user?.company_id) return;
  try {
    await recordAudit(pool, {
      company_id: user.company_id,
      user_id: user.id ?? null,
      user_name: user.name || null,
      user_email: user.email || null,
      user_role: user.role || null,
      action,
      entity: 'Session',
      entity_id: user.id ?? null,
      label: user.email || user.name || null,
      detail,
      ip: ipFrom(req),
    });
  } catch (err) {
    console.error('[audit] security', action, err.message);
  }
}

router.post('/login', authAttemptLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    const result = await query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      // Only a known account produces an entry: an unknown email belongs to no company, and the
      // table is scoped per company. Repeated failures on a real account are the signal worth
      // having anyway.
      await auditSecurity(req, { user, action: 'login_failed' });
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    await auditSecurity(req, { user, action: 'login' });
    const tokens = await issueTokens(user, req);
    res.json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post('/register', authAttemptLimit, async (req, res) => {
  try {
    const { email, password, name, company_name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
        [email]
      );
      if (existing.rows.length > 0) {
        const taken = new Error('EMAIL_TAKEN');
        taken.code = 'EMAIL_TAKEN';
        throw taken;
      }
      const company = await client.query(
        `INSERT INTO companies (name, email) VALUES ($1, $2) RETURNING id`,
        [company_name || 'Compania mea', email]
      );
      const userResult = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'admin') RETURNING *`,
        [company.rows[0].id, name || email.split('@')[0], email, password_hash]
      );
      return userResult.rows[0];
    });
    const tokens = await issueTokens(user, req);
    res.status(201).json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN' || isPgUniqueViolation(err)) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    console.error(err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    if (!result.rows[0]) return res.status(401).json({ message: 'User not found' });
    res.json(publicUser(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load user' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const token = String(req.body?.refresh_token || '').trim();
    if (!token) return res.status(400).json({ message: 'refresh_token required' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }
    if (payload.type !== 'refresh' || !payload.sub) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    const result = await query(
      `SELECT * FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (payload.company_id && payload.company_id !== user.company_id) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const session = await sessionUsable(payload.jti);
    if (!session.ok) {
      return res.status(401).json({ message: `Sesiune încheiată (${session.reason})` });
    }

    // Rotate: the new token gets its own row and the old one is retired, so a refresh token
    // that leaks is usable at most once before the real client's next refresh invalidates it.
    const tokens = await issueTokens(user, req);
    if (payload.jti) {
      await touchSession(payload.jti);
      await revokeSession(payload.jti);
    }
    res.json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Refresh failed' });
  }
});

/**
 * Ends the session the caller presents.
 *
 * Deliberately tolerant: a client logging out with an already-expired token still gets `ok`,
 * because the outcome it wants — this session no longer works — is true either way.
 */
router.post('/logout', async (req, res) => {
  try {
    const token = String(req.body?.refresh_token || '').trim();
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload?.jti) await revokeSession(payload.jti);
        // Logout carries no authenticated user; the verified payload is the only identity here.
        await auditSecurity(req, {
          user: { id: payload?.sub, company_id: payload?.company_id, email: payload?.email },
          action: 'logout',
        });
      } catch {
        // An expired or malformed token is already unusable; nothing to revoke.
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: true });
  }
});

/** The sessions signed in right now — what a lost phone needs in order to be cut off. */
router.get('/sessions', authRequired, async (req, res) => {
  try {
    res.json({ sessions: await listSessions(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Sesiunile nu au putut fi citite' });
  }
});

/** Signs out everywhere. The caller's own session goes too — that is the point. */
router.post('/sessions/revoke-all', authRequired, async (req, res) => {
  try {
    const revoked = await revokeAllForUser(req.user.id);
    await auditSecurity(req, { user: req.user, action: 'sessions_revoked', detail: { revoked } });
    res.json({ revoked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Sesiunile nu au putut fi încheiate' });
  }
});

router.post('/reset-password-request', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const origin = req.body?.origin || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    // Always return ok to avoid email enumeration
    const empty = { ok: true, message: 'If the email exists, a reset link was sent.' };
    if (!email) return res.json(empty);

    const result = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE LIMIT 1`,
      [email]
    );
    if (!result.rows[0]) return res.json(empty);

    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires_at = NOW() + INTERVAL '1 hour', updated_at = NOW()
       WHERE id = $2`,
      [token, result.rows[0].id]
    );

    const reset_link = `${origin.replace(/\/$/, '')}/reset-password?token=${token}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Resetare parolă Transitix',
        text: `Resetează parola aici (expiră în 1 oră): ${reset_link}`,
        html: `<p>Resetează parola aici (expiră în 1 oră):</p><p><a href="${reset_link}">${reset_link}</a></p>`,
      });
    } catch (mailErr) {
      console.error('[reset email]', mailErr);
      return res.status(500).json({ message: 'Reset email failed' });
    }

    // Local/dev: return link when Resend is not configured so UI can show it.
    if (emailConfigured()) {
      return res.json(empty);
    }
    res.json({ ...empty, reset_link });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Reset request failed' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: 'Token and new password required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    const result = await query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW()
       WHERE reset_token = $2
         AND reset_token_expires_at IS NOT NULL
         AND reset_token_expires_at > NOW()
         AND is_active = TRUE
       RETURNING id`,
      [password_hash, resetToken]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Password reset failed' });
  }
});

export default router;
