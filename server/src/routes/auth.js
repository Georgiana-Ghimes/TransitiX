import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authRequired, signAccessToken, signRefreshToken } from '../middleware/auth.js';

const router = Router();

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

router.post('/login', async (req, res) => {
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
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    const access_token = signAccessToken(user);
    const refresh_token = signRefreshToken(user);
    res.json({ access_token, refresh_token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, company_name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    const existing = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const company = await query(
      `INSERT INTO companies (name, email) VALUES ($1, $2) RETURNING id`,
      [company_name || 'Compania mea', email]
    );
    const password_hash = await bcrypt.hash(password, 12);
    const userResult = await query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING *`,
      [company.rows[0].id, name || email.split('@')[0], email, password_hash]
    );
    const user = userResult.rows[0];
    const access_token = signAccessToken(user);
    const refresh_token = signRefreshToken(user);
    res.status(201).json({ access_token, refresh_token, user: publicUser(user) });
  } catch (err) {
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

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
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
    console.log('[email stub] password reset link:', reset_link);

    // MVP without mail provider: return link so UI can show it in local/dev.
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

    const result = await query(
      `SELECT id FROM users
       WHERE reset_token = $1
         AND reset_token_expires_at IS NOT NULL
         AND reset_token_expires_at > NOW()
         AND is_active = TRUE
       LIMIT 1`,
      [resetToken]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW()
       WHERE id = $2`,
      [password_hash, result.rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Password reset failed' });
  }
});

export default router;
