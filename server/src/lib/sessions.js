/**
 * Refresh-token sessions, so that logging out actually ends one.
 *
 * A signed JWT is valid until it expires; nothing about holding one proves the holder is still
 * allowed in. Before this table, `POST /auth/logout` returned `{ ok: true }` and did nothing —
 * the client dropped its copy while the token kept working for a week. A lost phone or a
 * departed employee kept access, and there was no way to take it away.
 *
 * Each refresh token now carries a `jti` backed by a row here. Refreshing checks the row; logging
 * out revokes it. Access tokens are deliberately *not* checked per request — that would put a
 * database read in front of every call — so the exposure window after a revocation is however
 * long an access token lives (`JWT_EXPIRES_IN`). Keep that short.
 */
import crypto from 'crypto';
import { query } from '../db.js';

/** Rows older than this are gone anyway; keeping them only grows the table. */
const PRUNE_AFTER_DAYS = 30;

export function newSessionId() {
  return crypto.randomUUID();
}

/** Turns `7d` / `12h` / `30m` into milliseconds. Anything unparseable falls back to seven days. */
export function durationMs(text, fallbackMs = 7 * 24 * 60 * 60 * 1000) {
  const match = String(text ?? '').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackMs;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return value * factor;
}

export async function recordSession({ jti, userId, companyId, userAgent, ttlMs }) {
  await query(
    `INSERT INTO refresh_tokens (jti, user_id, company_id, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5::bigint || ' milliseconds')::interval)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, userId, companyId, String(userAgent ?? '').slice(0, 300) || null, Math.round(ttlMs)]
  );
}

/**
 * Whether a refresh token may still be used.
 *
 * A token minted before this table existed has no `jti` and no row. Rejecting those would log
 * out every signed-in user the moment this deploys, so they are accepted once and replaced with
 * a tracked one on the next refresh.
 */
export async function sessionUsable(jti) {
  if (!jti) return { ok: true, legacy: true };
  const found = await query(
    'SELECT jti, revoked_at, expires_at FROM refresh_tokens WHERE jti = $1',
    [jti]
  );
  const row = found.rows[0];
  // A tracked token whose row is gone was revoked and pruned; treat it as revoked, not as legacy.
  if (!row) return { ok: false, reason: 'necunoscut' };
  if (row.revoked_at) return { ok: false, reason: 'revocat' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expirat' };
  return { ok: true };
}

export async function touchSession(jti) {
  if (!jti) return;
  await query('UPDATE refresh_tokens SET last_used_at = NOW() WHERE jti = $1', [jti]);
}

export async function revokeSession(jti) {
  if (!jti) return 0;
  const res = await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = $1 AND revoked_at IS NULL',
    [jti]
  );
  return res.rowCount;
}

/** Every session for one person — what "sign out everywhere" means, and what a lost phone needs. */
export async function revokeAllForUser(userId) {
  const res = await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  return res.rowCount;
}

export async function listSessions(userId) {
  const found = await query(
    `SELECT jti, user_agent, issued_at, expires_at, revoked_at, last_used_at
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_used_at DESC NULLS LAST, issued_at DESC`,
    [userId]
  );
  return found.rows;
}

/** Housekeeping: nothing else ever deletes from this table. */
export async function pruneExpiredSessions() {
  const res = await query(
    `DELETE FROM refresh_tokens
     WHERE expires_at < NOW() - ($1::int || ' days')::interval`,
    [PRUNE_AFTER_DAYS]
  );
  return res.rowCount;
}
