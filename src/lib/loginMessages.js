/**
 * Copy the Login screen shows for each failed sign-in path.
 *
 * Server codes + Romanian messages are the source of truth; this map guarantees the UI never
 * falls through to a generic „sesiune expirată” when the failure is actually credentials,
 * a disabled account, or rate limiting.
 */
import { friendlyErrorMessage, isOfflineError } from './notify.js';

const BY_CODE = {
  INVALID_CREDENTIALS: 'Email sau parolă greșite. Verifică datele și încearcă din nou.',
  ACCOUNT_DISABLED: 'Contul este dezactivat. Contactează administratorul firmei.',
  EMAIL_NOT_VERIFIED:
    'Adresa de email nu este confirmată încă. Deschide linkul primit pe email sau cere altul.',
  GOOGLE_NEEDS_INVITE: null, // use server message (includes domain / email)
  GOOGLE_NEEDS_COMPANY: null,
  GOOGLE_ACCOUNT_MISMATCH:
    'Adresa este legată de alt cont Google. Folosește contul corect sau autentifică-te cu parola.',
  GOOGLE_SIGNIN_DISABLED:
    'Autentificarea cu Google este dezactivată pe acest server. Folosește email și parola.',
  SIGNUP_DISABLED: null,
};

/**
 * @param {unknown} err  API error (status + data.code + data.message)
 * @returns {string}
 */
export function loginErrorMessage(err) {
  if (isOfflineError(err)) {
    return 'Nu am putut contacta serverul. Verifică conexiunea și că aplicația rulează, apoi încearcă din nou.';
  }

  const code = err?.data?.code || err?.code;
  const serverMsg = String(err?.data?.message || err?.message || '').trim();

  if (code && Object.prototype.hasOwnProperty.call(BY_CODE, code)) {
    const mapped = BY_CODE[code];
    if (mapped) return mapped;
    if (serverMsg) return serverMsg;
  }

  if (err?.status === 429) {
    return serverMsg || 'Prea multe încercări de autentificare. Așteaptă câteva minute și încearcă din nou.';
  }

  if (err?.status === 400 && serverMsg) return serverMsg;

  // Prefer the server's Romanian sentence (friendlyErrorMessage keeps reader copy on 401/403).
  return friendlyErrorMessage(err);
}
