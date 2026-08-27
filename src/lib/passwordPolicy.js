/**
 * The password rule, as the browser needs to state it.
 *
 * The server is the authority — `server/src/lib/password.js` is what actually decides — but the
 * screen has to say the rule *before* somebody types, and a form that lets a password through
 * only for the API to bounce it is worse than one that never offered.
 *
 * The two are kept in step by a test that imports both and compares them. That is the same
 * arrangement as the UIT prefix, and for the same reason: a duplicated constant nobody checks is
 * a constant that will drift.
 */

export const MIN_LENGTH = 10;

export const PASSWORD_HINT =
  `Cel puțin ${MIN_LENGTH} caractere. Fără reguli de majuscule sau simboluri — `
  + 'o frază lungă e mai bună decât una scurtă cu semne.';

/**
 * The cheap checks, so the form can answer immediately.
 *
 * Deliberately not the whole policy: the blocklist and the "does not contain your own email"
 * rule live on the server, which is where they cannot be skipped. This catches the common case
 * without pretending to be the authority.
 */
export function localPasswordError(password, { confirm } = {}) {
  const value = String(password ?? '');
  if (!value) return 'Introdu o parolă.';
  if (value.length < MIN_LENGTH) return `Parola trebuie să aibă cel puțin ${MIN_LENGTH} caractere.`;
  if (value.trim() !== value) return 'Parola nu poate începe sau se termina cu spațiu.';
  if (confirm !== undefined && value !== confirm) return 'Parolele nu coincid.';
  return null;
}
