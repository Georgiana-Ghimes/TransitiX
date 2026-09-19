/**
 * What the sign-up and invitation forms can say about an address before the server is asked.
 *
 * Mirrors `server/src/lib/auth/signup.js`; `emailKind.test.js` fails when the two drift. The
 * server stays the authority, this only lets the form warn while the person is still typing.
 */

export const PASSWORD_MIN_LENGTH = 10;

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

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isEmailShape(email) {
  return EMAIL_SHAPE.test(normaliseEmail(email));
}

export function classifyEmail(email) {
  const clean = normaliseEmail(email);
  const at = clean.lastIndexOf('@');
  const domain = at > 0 ? clean.slice(at + 1) : '';
  return { domain, personal: Boolean(domain) && PERSONAL.has(domain) };
}

/** Same rule as the server, so the form can say it before the round trip. */
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
 * The warnings a sign-up form shows for the address it has, in the order they matter.
 *
 * `check` is the server's `/auth/check-email` answer when there is one. Each item is
 * `{ code, level, text }`; `level: 'error'` blocks submitting, `'warning'` asks for attention.
 */
export function signupEmailNotices(email, accountType, check = null) {
  const notices = [];
  const clean = normaliseEmail(email);
  if (!clean) return notices;
  if (!isEmailShape(clean)) {
    notices.push({ code: 'invalid', level: 'error', text: 'Adresa de email nu pare validă.' });
    return notices;
  }
  const { domain, personal } = classifyEmail(clean);
  if (accountType === 'institution' && personal) {
    notices.push({
      code: 'personal_as_institution',
      level: 'error',
      text: `@${domain} este o adresă personală, nu a firmei. Alege „Email personal” sau scrie adresa de la firmă.`,
    });
  }
  if (accountType === 'personal' && !personal && domain) {
    notices.push({
      code: 'institution_as_personal',
      level: 'warning',
      text: `@${domain} pare adresa unei firme. Dacă e adresa de serviciu, alege „Email de firmă”.`,
    });
  }
  if (check?.email_taken) {
    notices.push({
      code: 'taken',
      level: 'error',
      text: 'Există deja un cont cu această adresă. Autentifică-te sau folosește „Ai uitat parola?”.',
    });
  } else if (check?.domain_in_use) {
    notices.push({
      code: 'domain_in_use',
      level: 'warning',
      text: `Colegi de pe @${domain} folosesc deja Transitix. Dacă sunteți aceeași firmă, cere o invitație `
        + 'administratorului în loc să creezi o firmă nouă.',
    });
  }
  return notices;
}

/** Warnings for an address an admin is about to invite or add. Never blocking. */
export function inviteEmailNotices(email, { adminEmail } = {}) {
  const { domain, personal } = classifyEmail(email);
  if (!domain || !isEmailShape(email)) return [];
  const notices = [];
  const companyDomain = classifyEmail(adminEmail);
  if (personal) {
    notices.push({
      code: 'personal',
      text: `@${domain} este o adresă personală. Verifică încă o dată că e a persoanei potrivite: contul dă acces la datele firmei.`,
    });
  } else if (companyDomain.domain && !companyDomain.personal && companyDomain.domain !== domain) {
    notices.push({
      code: 'other_domain',
      text: `Adresa e pe @${domain}, nu pe @${companyDomain.domain}. Corect dacă persoana e colaborator extern.`,
    });
  }
  return notices;
}
