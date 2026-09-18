import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { isPgUniqueViolation } from '../lib/concurrency.js';
import { authRequired, signAccessToken, signRefreshToken } from '../middleware/auth.js';
import { emailConfigured } from '../lib/email.js';
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
import {
  PASSWORD_MIN_LENGTH,
  VERIFY_TTL_HOURS,
  classifyEmail,
  hashToken,
  isEmailShape,
  newToken,
  passwordProblem,
  validateSignup,
} from '../lib/auth/signup.js';
import { googleClientId, verifyGoogleIdToken } from '../lib/auth/google.js';
import { appLink, deliverAccountEmail, resetEmail, verificationEmail } from '../lib/auth/mail.js';
import { normaliseEmail, unusablePasswordSeed } from '../lib/users/rules.js';

const router = Router();
// One window per route: a burst of sign-ups must not lock the same office out of signing in.
const attemptLimit = () => rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
// Checking an address answers "is this taken", which is worth rationing.
const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
// Every one of these sends an email to somebody who may not have asked for it.
const mailLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

/** `ALLOW_SIGNUP=false` turns self-service registration off (a single-customer deployment). */
export function signupEnabled() {
  return String(process.env.ALLOW_SIGNUP ?? 'true').trim().toLowerCase() !== 'false';
}

const SIGNUP_CLOSED = {
  code: 'SIGNUP_DISABLED',
  message: 'Înregistrarea de conturi noi este oprită pe acest server. Cere o invitație administratorului firmei tale.',
};

/** Postgres down or unreachable, say so plainly instead of a generic 500. */
function isDbUnavailable(err) {
  const code = err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === '57P03') {
    return true;
  }
  if (err?.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.some((e) => isDbUnavailable(e));
  }
  return false;
}

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
    must_change_password: Boolean(row.must_change_password),
    email_verified: Boolean(row.email_verified_at),
  };
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.extra = extra;
  return err;
}

/** One address, one account, across every company: login looks the address up globally. */
async function findByEmail(db, email) {
  const clean = normaliseEmail(email);
  if (!clean) return null;
  const res = await db.query(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) ORDER BY is_active DESC, created_at LIMIT 1`,
    [clean]
  );
  return res.rows[0] || null;
}

/** A Google account already linked to a row, even if the mailbox was renamed on Google's side. */
async function findByGoogleSub(db, sub) {
  const id = String(sub || '').trim();
  if (!id) return null;
  const res = await db.query(
    `SELECT * FROM users WHERE google_sub = $1 ORDER BY is_active DESC, created_at LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

/** Whether some company already has active people on this (non-personal) domain. */
async function domainInUse(db, domain) {
  if (!domain) return false;
  const res = await db.query(
    `SELECT 1 FROM users WHERE LOWER(split_part(email, '@', 2)) = $1 AND is_active = TRUE LIMIT 1`,
    [domain]
  );
  return res.rowCount > 0;
}

/** A new company and its first administrator, inside the caller's transaction. */
async function createCompanyWithAdmin(client, {
  companyName, email, name, passwordHash, createdVia, verified, googleSub = null, verifyHash = null,
}) {
  const company = await client.query(
    `INSERT INTO companies (name, email) VALUES ($1, $2) RETURNING id, name`,
    [companyName, email]
  );
  const user = await client.query(
    `INSERT INTO users (company_id, name, email, password_hash, role, created_via,
                        email_verified_at, google_sub, email_verify_token_hash, email_verify_expires_at)
     VALUES ($1, $2, $3, $4, 'admin', $5,
             CASE WHEN $6::boolean THEN NOW() END, $7, $8::text,
             CASE WHEN $8::text IS NOT NULL THEN NOW() + ($9::int || ' hours')::interval END)
     RETURNING *`,
    [company.rows[0].id, name, email, passwordHash, createdVia, verified, googleSub, verifyHash,
      VERIFY_TTL_HOURS]
  );
  return { company: company.rows[0], user: user.rows[0] };
}

async function sendVerification(req, user, token) {
  const link = appLink(req, '/verify-email', token);
  const sent = await deliverAccountEmail({
    to: user.email,
    ...verificationEmail({ name: user.name, link, hours: VERIFY_TTL_HOURS }),
  });
  return { sent, link };
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
 * line in the trail, so this swallows its own errors and says so in the log instead.
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

/** Errors thrown with a status carry their own copy; everything else is a 500. */
function failAuth(res, err, fallback) {
  if (err?.status) return res.status(err.status).json({ message: err.message, ...(err.extra || {}) });
  console.error(err);
  if (isDbUnavailable(err)) {
    return res.status(503).json({
      message: 'Serverul nu poate accesa baza de date. Verifică dacă baza rulează sau contactează biroul.',
    });
  }
  return res.status(500).json({ message: fallback });
}

router.post('/login', attemptLimit(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Completează emailul și parola.' });
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
      return res.status(401).json({ message: 'Email sau parolă greșite.' });
    }
    // Only a self sign-up waits on its link. Invited people prove the address by setting their
    // password from it, a manual account is vouched for by its admin, and rows written by a seed
    // script have no created_via at all.
    if (user.created_via === 'signup' && !user.email_verified_at) {
      // The password was right, so saying why is not an enumeration leak.
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        message: 'Adresa de email nu este confirmată încă. Deschide linkul primit pe email sau cere altul.',
      });
    }
    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    await auditSecurity(req, { user, action: 'login' });
    const tokens = await issueTokens(user, req);
    res.json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    failAuth(res, err, 'Autentificarea nu a reușit. Încearcă din nou.');
  }
});

/** What the sign-in and sign-up screens may offer on this server. */
router.get('/providers', (_req, res) => {
  res.json({
    signup_enabled: signupEnabled(),
    google_client_id: googleClientId(),
    email_configured: emailConfigured(),
    password_min_length: PASSWORD_MIN_LENGTH,
  });
});

/**
 * What the sign-up form should say about an address before it is submitted.
 *
 * `email_taken` repeats what submitting would say anyway (409); `domain_in_use` is a yes/no and
 * never names the company, which is all the form needs to suggest asking for an invitation.
 */
router.post('/check-email', lookupLimit, async (req, res) => {
  try {
    const email = normaliseEmail(req.body?.email);
    if (!isEmailShape(email)) {
      return res.json({ valid: false, message: 'Adresa de email nu pare validă.' });
    }
    const { domain, personal } = classifyEmail(email);
    const taken = Boolean(await findByEmail({ query }, email));
    const inUse = !personal && !taken ? await domainInUse({ query }, domain) : false;
    res.json({ valid: true, domain, personal, email_taken: taken, domain_in_use: inUse });
  } catch (err) {
    failAuth(res, err, 'Nu am putut verifica adresa. Încearcă din nou.');
  }
});

/**
 * A new company, with the person registering as its administrator.
 *
 * No tokens come back: the account signs in only after the address is confirmed. Without a mail
 * provider the link is returned instead, a stubbed send is not a send.
 */
router.post('/register', attemptLimit(), async (req, res) => {
  try {
    if (!signupEnabled()) return res.status(403).json(SIGNUP_CLOSED);
    const check = validateSignup(req.body || {});
    if (!check.ok) {
      return res.status(400).json({
        code: 'INVALID_SIGNUP', message: check.errors.join(' '), errors: check.errors,
      });
    }
    const v = check.value;

    const passwordHash = await bcrypt.hash(String(req.body.password), 12);
    const { token, hash } = newToken();
    const { user } = await withTransaction(async (client) => {
      const existing = await findByEmail(client, v.email);
      if (existing) {
        throw httpError(409, existing.is_active
          ? 'Există deja un cont cu acest email. Autentifică-te sau folosește „Ai uitat parola?”.'
          : 'Există un cont dezactivat cu acest email. Cere administratorului firmei să-l reactiveze.',
        { code: 'EMAIL_TAKEN' });
      }
      if (!v.personal && req.body?.confirm_domain !== true && await domainInUse(client, v.domain)) {
        throw httpError(409,
          `Există deja conturi Transitix pe domeniul @${v.domain}. Dacă firma ta folosește deja aplicația, `
          + 'cere o invitație administratorului în loc să creezi o firmă nouă.',
          { code: 'DOMAIN_IN_USE', domain: v.domain });
      }
      return createCompanyWithAdmin(client, {
        companyName: v.company_name,
        email: v.email,
        name: v.name,
        passwordHash,
        createdVia: 'signup',
        verified: false,
        verifyHash: hash,
      });
    });

    await auditSecurity(req, { user, action: 'create', detail: { signup: v.account_type } });
    const { sent, link } = await sendVerification(req, user, token);
    res.status(201).json({
      verification_required: true,
      email: user.email,
      email_sent: sent,
      verify_link: sent ? undefined : link,
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'Există deja un cont cu acest email.' });
    }
    failAuth(res, err, 'Crearea contului nu a reușit. Încearcă din nou.');
  }
});

/** Following the link from the verification email. Signs the person in on success. */
router.post('/verify-email', attemptLimit(), async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ message: 'Linkul de confirmare este incomplet.' });
    const result = await query(
      `UPDATE users
       SET email_verified_at = NOW(), email_verify_token_hash = NULL, email_verify_expires_at = NULL,
           last_login = NOW(), updated_at = NOW()
       WHERE email_verify_token_hash = $1 AND email_verify_expires_at > NOW() AND is_active = TRUE
       RETURNING *`,
      [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(400).json({
        code: 'VERIFY_LINK_INVALID',
        message: 'Linkul de confirmare a expirat sau a fost deja folosit. Autentifică-te sau cere un link nou.',
      });
    }
    await auditSecurity(req, { user, action: 'login', detail: { email_verified: true } });
    const tokens = await issueTokens(user, req);
    res.json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    failAuth(res, err, 'Confirmarea nu a reușit. Încearcă din nou.');
  }
});

/** A new verification link. Answers the same whether or not the address exists. */
router.post('/resend-verification', mailLimit, async (req, res) => {
  const empty = { ok: true, message: 'Dacă adresa are un cont neconfirmat, am trimis un link nou.' };
  try {
    const email = normaliseEmail(req.body?.email);
    if (!isEmailShape(email)) return res.json(empty);
    const user = await findByEmail({ query }, email);
    if (!user || !user.is_active || user.email_verified_at || user.created_via !== 'signup') {
      return res.json(empty);
    }

    const { token, hash } = newToken();
    await query(
      `UPDATE users SET email_verify_token_hash = $1,
              email_verify_expires_at = NOW() + ($2::int || ' hours')::interval, updated_at = NOW()
       WHERE id = $3`,
      [hash, VERIFY_TTL_HOURS, user.id]
    );
    const { sent, link } = await sendVerification(req, user, token);
    if (!sent && emailConfigured()) {
      return res.status(502).json({ message: 'Emailul nu a putut fi trimis. Încearcă din nou în câteva minute.' });
    }
    // Local/dev only: without a provider the link is the one way to finish.
    res.json(sent ? empty : { ...empty, verify_link: link });
  } catch (err) {
    failAuth(res, err, 'Nu am putut trimite linkul. Încearcă din nou.');
  }
});

/**
 * Sign in or sign up with Google.
 *
 * An existing account signs in when either the Google subject is already linked or the address
 * matches: Google has just proved the mailbox, which is the same proof a reset link gives, so it
 * also claims a pending invitation and confirms an unverified sign-up.
 *
 * A brand-new address needs a company name (`GOOGLE_NEEDS_COMPANY`). When the domain already has
 * people on Transitix but this mailbox does not, Login must not open "create a company": that is
 * `GOOGLE_NEEDS_INVITE`. Register may still create a second company with an explicit confirmation.
 *
 * A temporary password set by an admin is not cleared: whoever typed it still knows it.
 */
router.post('/google', attemptLimit(), async (req, res) => {
  try {
    const identity = await verifyGoogleIdToken(req.body?.credential);
    const email = normaliseEmail(identity.email);
    const existing = (await findByGoogleSub({ query }, identity.sub))
      || (await findByEmail({ query }, email));

    if (existing) {
      if (!existing.is_active) {
        return res.status(403).json({ message: 'Contul este dezactivat. Contactează administratorul firmei.' });
      }
      if (existing.google_sub && existing.google_sub !== identity.sub) {
        return res.status(401).json({ message: 'Adresa este legată de alt cont Google.' });
      }
      const updated = (await query(
        `UPDATE users
         SET google_sub = $1, email_verified_at = COALESCE(email_verified_at, NOW()),
             email_verify_token_hash = NULL, email_verify_expires_at = NULL,
             reset_token = CASE WHEN last_login IS NULL THEN NULL ELSE reset_token END,
             reset_token_expires_at = CASE WHEN last_login IS NULL THEN NULL ELSE reset_token_expires_at END,
             last_login = NOW(), updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [identity.sub, existing.id]
      )).rows[0];
      await auditSecurity(req, { user: updated, action: 'login', detail: { provider: 'google' } });
      const tokens = await issueTokens(updated, req);
      return res.json({ ...tokens, user: publicUser(updated) });
    }

    if (!signupEnabled()) {
      return res.status(403).json({
        ...SIGNUP_CLOSED,
        message: `Nu există niciun cont pentru ${email}. ${SIGNUP_CLOSED.message}`,
      });
    }

    const { domain, personal } = classifyEmail(email);
    const companyName = String(req.body?.company_name || '').trim();
    const domainTaken = !personal && await domainInUse({ query }, domain);
    // Login must not open "create a company" when colleagues already use this domain. Register
    // still gets GOOGLE_NEEDS_COMPANY so it can ask for a deliberate second firm.
    const fromSignIn = String(req.body?.intent || '').trim().toLowerCase() !== 'signup';

    if (companyName.length < 2) {
      if (domainTaken && fromSignIn) {
        return res.status(403).json({
          code: 'GOOGLE_NEEDS_INVITE',
          message: `Există deja conturi Transitix pe @${domain}, dar nu și pentru ${email}. `
            + 'Cere o invitație administratorului firmei (Setări › Utilizatori), apoi intră din nou cu Google.',
          email,
          name: identity.name,
          personal,
          domain,
          domain_in_use: true,
        });
      }
      return res.status(409).json({
        code: 'GOOGLE_NEEDS_COMPANY',
        message: 'Nu există încă un cont pentru această adresă. Completează numele firmei ca să-l creezi.',
        email,
        name: identity.name,
        personal,
        domain,
        domain_in_use: domainTaken,
      });
    }

    const passwordHash = await bcrypt.hash(
      unusablePasswordSeed(crypto.randomBytes(32).toString('hex')), 12
    );
    const { user } = await withTransaction(async (client) => {
      if (await findByEmail(client, email)) {
        throw httpError(409, 'Există deja un cont cu acest email.', { code: 'EMAIL_TAKEN' });
      }
      if (await findByGoogleSub(client, identity.sub)) {
        throw httpError(409, 'Contul Google este deja legat de alt utilizator.', { code: 'GOOGLE_TAKEN' });
      }
      if (!personal && req.body?.confirm_domain !== true && await domainInUse(client, domain)) {
        throw httpError(409,
          `Există deja conturi Transitix pe domeniul @${domain}. Cere o invitație administratorului `
          + 'sau confirmă că vrei o firmă nouă.',
          { code: 'DOMAIN_IN_USE', domain });
      }
      return createCompanyWithAdmin(client, {
        companyName,
        email,
        name: identity.name || email.split('@')[0],
        passwordHash,
        createdVia: 'google',
        verified: true,
        googleSub: identity.sub,
      });
    });
    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    await auditSecurity(req, { user, action: 'create', detail: { signup: 'google' } });
    const tokens = await issueTokens(user, req);
    res.status(201).json({ ...tokens, user: publicUser(user), created: true });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return res.status(409).json({ message: 'Contul Google este deja legat de alt utilizator.' });
    }
    failAuth(res, err, 'Autentificarea cu Google nu a reușit. Încearcă din nou.');
  }
});

/**
 * Choosing a new password while signed in, and the only way out of a temporary one.
 *
 * Every other session is ended and a fresh pair is returned: whoever else knew the old password
 * (for a manual account, the admin who typed it) should not stay signed in with it.
 */
router.post('/change-password', authRequired, attemptLimit(), async (req, res) => {
  try {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');
    const user = (await query(
      `SELECT * FROM users WHERE id = $1 AND is_active = TRUE`, [req.user.id]
    )).rows[0];
    if (!user) return res.status(401).json({ message: 'Utilizatorul nu există.' });

    if (!current || !(await bcrypt.compare(current, user.password_hash))) {
      return res.status(400).json({ code: 'WRONG_PASSWORD', message: 'Parola actuală nu este corectă.' });
    }
    const problem = passwordProblem(next, { email: user.email });
    if (problem) return res.status(400).json({ message: problem });
    if (current === next) {
      return res.status(400).json({ message: 'Parola nouă trebuie să fie diferită de cea actuală.' });
    }

    const hash = await bcrypt.hash(next, 12);
    const updated = (await query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE,
              reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [hash, user.id]
    )).rows[0];
    const revoked = await revokeAllForUser(user.id);
    await auditSecurity(req, {
      user: updated,
      action: 'sessions_revoked',
      detail: { password_changed: true, revoked, was_temporary: user.must_change_password },
    });
    const tokens = await issueTokens(updated, req);
    res.json({ ...tokens, user: publicUser(updated) });
  } catch (err) {
    failAuth(res, err, 'Parola nu a putut fi schimbată. Încearcă din nou.');
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    if (!result.rows[0]) return res.status(401).json({ message: 'Utilizatorul nu există.' });
    res.json(publicUser(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Nu am putut încărca datele contului.' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const token = String(req.body?.refresh_token || '').trim();
    if (!token) return res.status(400).json({ message: 'Sesiune lipsă. Conectează-te din nou.' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Sesiunea a expirat. Conectează-te din nou.' });
    }
    if (payload.type !== 'refresh' || !payload.sub) {
      return res.status(401).json({ message: 'Sesiunea nu mai este validă. Conectează-te din nou.' });
    }
    const result = await query(
      `SELECT * FROM users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Utilizatorul nu există.' });
    if (payload.company_id && payload.company_id !== user.company_id) {
      return res.status(401).json({ message: 'Sesiunea nu mai este validă. Conectează-te din nou.' });
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
    res.status(500).json({ message: 'Reînnoirea sesiunii nu a reușit. Conectează-te din nou.' });
  }
});

/**
 * Ends the session the caller presents.
 *
 * Deliberately tolerant: a client logging out with an already-expired token still gets `ok`,
 * because the outcome it wants, this session no longer works, is true either way.
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

/** The sessions signed in right now, what a lost phone needs in order to be cut off. */
router.get('/sessions', authRequired, async (req, res) => {
  try {
    res.json({ sessions: await listSessions(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Sesiunile nu au putut fi citite' });
  }
});

/** Signs out everywhere. The caller's own session goes too, that is the point. */
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

router.post('/reset-password-request', mailLimit, async (req, res) => {
  try {
    const email = normaliseEmail(req.body?.email);
    // Always return ok to avoid email enumeration
    const empty = { ok: true, message: 'Dacă emailul există, am trimis un link de resetare.' };
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

    // The link's host comes from CLIENT_ORIGIN, never from the request alone: a reset asked for
    // with somebody else's address and an attacker's origin would otherwise deliver the token there.
    const reset_link = appLink(req, '/reset-password', token);
    const sent = await deliverAccountEmail({ to: email, ...resetEmail({ link: reset_link }) });
    if (emailConfigured()) {
      if (!sent) {
        return res.status(502).json({ message: 'Nu am putut trimite emailul de resetare. Încearcă din nou.' });
      }
      return res.json(empty);
    }
    // Local/dev: return link when Resend is not configured so UI can show it.
    res.json({ ...empty, reset_link });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Cererea de resetare nu a reușit. Încearcă din nou.' });
  }
});

/**
 * Setting a password from a link: a reset, or accepting an invitation.
 *
 * Following the link proves the mailbox, so it also confirms the address and clears a temporary
 * password. Every session ends, a reset exists because the old password may be known elsewhere.
 */
router.post('/reset-password', attemptLimit(), async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: 'Completează parola nouă.' });
    }
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ message: problem });

    const password_hash = await bcrypt.hash(newPassword, 12);
    const result = await query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL,
           must_change_password = FALSE,
           email_verified_at = COALESCE(email_verified_at, NOW()),
           email_verify_token_hash = NULL, email_verify_expires_at = NULL,
           updated_at = NOW()
       WHERE reset_token = $2
         AND reset_token_expires_at IS NOT NULL
         AND reset_token_expires_at > NOW()
         AND is_active = TRUE
       RETURNING id`,
      [password_hash, resetToken]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ message: 'Linkul de resetare este invalid sau a expirat. Cere unul nou.' });
    }
    await revokeAllForUser(result.rows[0].id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Resetarea parolei nu a reușit. Încearcă din nou.' });
  }
});

export default router;
