/**
 * The rules for somebody creating an account on their own.
 *
 * Three things a sign-up form gets wrong quietly:
 *
 * 1. **An address nobody checked.** A company created under a typo belongs to nobody, and the
 *    real person later finds their address "already taken". Sign-up therefore ends in a
 *    verification link, and the account cannot sign in until it is followed.
 * 2. **A second company for people who already have one.** A colleague who registers instead of
 *    asking for an invitation creates an empty company beside the real one. When the domain of a
 *    company address is already in use, the form says so and asks for a deliberate confirmation.
 * 3. **A personal address filed as a company one.** `@gmail.com` says nothing about the employer,
 *    so it can never be the signal for rule 2, and choosing "email de firmă" with it is refused.
 *
 * `src/lib/emailKind.js` mirrors `PERSONAL_EMAIL_DOMAINS` for the browser; a test keeps them equal.
 */
import crypto from 'crypto';
import { normaliseEmail } from '../users/rules.js';

/** Shortest password accepted anywhere a person chooses one. Mirrored in `src/lib/emailKind.js`. */
export const PASSWORD_MIN_LENGTH = 10;

/** How long a verification link stays usable. Somebody signing up is usually at the screen. */
export const VERIFY_TTL_HOURS = 48;

/** Free mailbox providers: the domain says who hosts the mail, not who employs the person. */
export const PERSONAL_EMAIL_DOMAINS = [
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'mail.ru',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.co.uk',
  'yahoo.com',
  'yahoo.ro',
  'yandex.com',
  'yandex.ru',
  'ymail.com',
  'zoho.com',
];

const PERSONAL = new Set(PERSONAL_EMAIL_DOMAINS);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const ACCOUNT_TYPES = ['institution', 'personal'];

export function isEmailShape(email) {
  return EMAIL_SHAPE.test(normaliseEmail(email));
}

export function emailDomain(email) {
  const clean = normaliseEmail(email);
  const at = clean.lastIndexOf('@');
  return at > 0 ? clean.slice(at + 1) : '';
}

/** `{ domain, personal }`, where `personal` means the domain identifies no employer. */
export function classifyEmail(email) {
  const domain = emailDomain(email);
  return { domain, personal: Boolean(domain) && PERSONAL.has(domain) };
}

/** A reason the password is refused, or null. Length only: composition rules produce `Parola1!`. */
export function passwordProblem(password, { email } = {}) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Parola trebuie să aibă cel puțin ${PASSWORD_MIN_LENGTH} caractere.`;
  }
  if (value.length > 200) return 'Parola este prea lungă (maximum 200 de caractere).';
  // Almost always a copy-paste slip, and it locks the person out the next time they type it.
  if (value !== value.trim()) return 'Parola nu poate începe sau se termina cu spațiu.';
  const local = normaliseEmail(email).split('@')[0];
  if (local && local.length >= 4 && value.toLowerCase().includes(local)) {
    return 'Parola nu poate conține adresa de email.';
  }
  return null;
}

/**
 * Checks a sign-up before anything is written.
 *
 * Every problem is reported at once: a form that reveals its rules one submit at a time teaches
 * people to stop trying.
 */
export function validateSignup(body = {}) {
  const errors = [];
  const email = normaliseEmail(body.email);
  const name = String(body.name || '').trim();
  const companyName = String(body.company_name || '').trim();
  const accountType = ACCOUNT_TYPES.includes(body.account_type) ? body.account_type : 'institution';
  const { domain, personal } = classifyEmail(email);

  if (!isEmailShape(email)) errors.push('Adresa de email nu pare validă.');
  if (name.length < 2) errors.push('Completează numele tău.');
  if (companyName.length < 2) errors.push('Completează numele firmei.');
  if (companyName.length > 200) errors.push('Numele firmei este prea lung.');
  if (accountType === 'institution' && personal) {
    errors.push(`@${domain} este o adresă personală. Alege „Email personal” sau folosește adresa firmei.`);
  }
  const pwd = passwordProblem(body.password, { email });
  if (pwd) errors.push(pwd);

  return {
    ok: errors.length === 0,
    errors,
    value: { email, name, company_name: companyName, account_type: accountType, domain, personal },
  };
}

/** A verification or invitation token: the plaintext goes in the link, only the hash is stored. */
export function newToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// No 0/O, 1/l/I: the password is read off one screen and typed on another.
const READABLE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A temporary password an admin can read out. Random enough for the one sign-in it lasts. */
export function temporaryPassword(length = 12, randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += READABLE[bytes[i] % READABLE.length];
  return out;
}
