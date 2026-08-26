/**
 * The rules for administering people.
 *
 * Until now a colleague was added with an `INSERT`, which meant three things: only whoever had
 * database access could do it, nobody could see who had been given which role, and — because the
 * password hash had to come from somewhere — an admin ended up knowing another person's password.
 *
 * Two decisions run through this file:
 *
 * 1. **Nobody sets a password for somebody else.** An invitation carries a link; the person
 *    chooses their own. An admin who types a colleague's password knows it forever, and the
 *    audit trail then cannot tell the two of them apart.
 * 2. **Nobody is deleted.** `users.id` is on the audit trail, on the sessions and on the driver
 *    profile. Removing the row would blank the one column that says who did what. Deactivation
 *    is the operation; the history stays.
 */

export const ROLES = {
  admin: {
    label: 'Administrator',
    description: 'Tot, inclusiv utilizatori, tarife și jurnalul de modificări.',
  },
  dispatcher: {
    label: 'Dispecer',
    description: 'Curse, planificare, documente. Fără configurare comercială.',
  },
  finance: {
    label: 'Financiar',
    description: 'Facturi, rapoarte, avize. Fără dispecerat.',
  },
  driver: {
    label: 'Șofer',
    description: 'Doar aplicația de șofer. Are nevoie de un profil de șofer legat.',
  },
};

export const ROLE_NAMES = Object.keys(ROLES);

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

/** Emails are compared and stored lowercased; `Ana@x.ro` and `ana@x.ro` are one person. */
export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Checks an invitation before anything is written.
 *
 * The email has to be real enough to receive a link: an invitation that cannot arrive creates an
 * account nobody can ever sign into, and the only sign of it is a row somebody has to clean up.
 */
export function validateInvite({ name, email, role }) {
  const errors = [];
  const cleanName = String(name || '').trim();
  const cleanEmail = normaliseEmail(email);

  if (cleanName.length < 2) errors.push('Numele este obligatoriu.');
  if (!EMAIL_SHAPE.test(cleanEmail)) errors.push('Adresa de email nu pare validă.');
  if (!isRole(role)) errors.push('Rol necunoscut.');

  return { ok: errors.length === 0, errors, value: { name: cleanName, email: cleanEmail, role } };
}

/**
 * Whether a role change is allowed, and why not when it is not.
 *
 * `adminCount` counts the *active* admins. A company that demotes its last one locks itself out
 * of user administration, tariffs and the audit trail, and the only way back is SQL — which is
 * exactly what this screen exists to remove.
 */
export function checkRoleChange({ actorId, target, nextRole, adminCount }) {
  if (!isRole(nextRole)) return { ok: false, reason: 'Rol necunoscut.' };
  if (target.role === nextRole) return { ok: false, reason: 'Utilizatorul are deja rolul acesta.' };
  if (target.id === actorId) {
    // Not paternalism: an admin who demotes themselves by accident cannot undo it.
    return { ok: false, reason: 'Nu îți poți schimba propriul rol. Cere altui administrator.' };
  }
  if (target.role === 'admin' && target.is_active && adminCount <= 1) {
    return { ok: false, reason: 'Este ultimul administrator activ. Promovează pe altcineva întâi.' };
  }
  return { ok: true };
}

/** Whether an account may be deactivated — same last-admin and self rules. */
export function checkDeactivate({ actorId, target, adminCount }) {
  if (!target.is_active) return { ok: false, reason: 'Contul este deja dezactivat.' };
  if (target.id === actorId) {
    return { ok: false, reason: 'Nu îți poți dezactiva propriul cont.' };
  }
  if (target.role === 'admin' && adminCount <= 1) {
    return { ok: false, reason: 'Este ultimul administrator activ. Promovează pe altcineva întâi.' };
  }
  return { ok: true };
}

export function checkActivate({ target }) {
  if (target.is_active) return { ok: false, reason: 'Contul este deja activ.' };
  return { ok: true };
}

/**
 * How long an invitation link stays usable.
 *
 * Longer than a password reset — a reset is asked for by somebody sitting at the screen, while
 * an invitation waits for a person who may be driving today and reading email on Monday.
 */
export const INVITE_TTL_HOURS = 168;

/**
 * A password nobody knows, for an account waiting on its invitation.
 *
 * `password_hash` is NOT NULL, so the row needs something. It must never be a value anyone could
 * guess or reuse — the account is reachable only through the invitation link.
 */
export function unusablePasswordSeed(randomHex) {
  return `invite:${randomHex}`;
}

/**
 * What the list shows about one account, beyond its columns.
 *
 * `pending` is derived rather than stored: an account that has never signed in and still holds a
 * live invitation token has not been claimed yet. A separate status column would be a second
 * source of truth that drifts the first time somebody resets their password.
 */
export function inviteState(row, now = new Date()) {
  if (row.last_login) return 'active';
  if (row.reset_token && row.reset_token_expires_at && new Date(row.reset_token_expires_at) > now) {
    return 'invited';
  }
  return 'expired';
}

/**
 * Whether a driver-role account can actually use the driver app.
 *
 * A driver user with no driver profile signs in and finds nothing: no trips, no documents. The
 * list says so rather than letting somebody discover it on the road.
 */
export function driverReady(row) {
  return row.role !== 'driver' || Boolean(row.driver_id);
}
