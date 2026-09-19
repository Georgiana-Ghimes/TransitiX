/**
 * Account emails: verification, invitation, password reset.
 *
 * Two things every one of them has to get right:
 *
 * - **Where the link points.** The browser sends `origin` so a link opens the app it came from,
 *   but an origin taken on trust lets anybody request a reset for somebody else with their own
 *   host in it, and the victim's token arrives there. With `CLIENT_ORIGIN` set, only that origin
 *   is used; without it (local development) the browser's value is accepted.
 * - **Whether it went.** `sendEmail` resolves happily with no provider configured. A stubbed send
 *   is reported as not sent, so the caller can hand the link over instead of waiting for nothing.
 */
import { sendEmail } from '../email.js';

function allowedOrigins() {
  return String(process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function linkOrigin(req) {
  const asked = String(req?.body?.origin || '').trim().replace(/\/$/, '');
  const allowed = allowedOrigins();
  if (allowed.length > 0) return allowed.includes(asked) ? asked : allowed[0];
  if (/^https?:\/\/[^\s/]+$/i.test(asked)) return asked;
  return `${req.protocol}://${req.get('host')}`;
}

export function appLink(req, path, token) {
  return `${linkOrigin(req)}${path}?token=${encodeURIComponent(token)}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(paragraphs, link, cta) {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return `${body}<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;`
    + `background:#1D4E89;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(cta)}</a></p>`
    + `<p style="color:#64748b;font-size:12px">Dacă butonul nu merge, copiază linkul: ${escapeHtml(link)}</p>`;
}

/** Sends one account email; true only when a real provider accepted it. */
export async function deliverAccountEmail({ to, subject, paragraphs, link, cta }) {
  try {
    const result = await sendEmail({
      to,
      subject,
      text: `${paragraphs.join('\n\n')}\n\n${link}\n`,
      html: layout(paragraphs, link, cta),
    });
    return Boolean(result?.ok && !result.stub);
  } catch (err) {
    console.error('[auth-mail]', err.message);
    return false;
  }
}

export function verificationEmail({ name, link, hours }) {
  return {
    subject: 'Confirmă adresa de email · Transitix',
    paragraphs: [
      `Salut, ${name}.`,
      `Ai creat un cont Transitix. Confirmă adresa de email ca să te poți autentifica (link valabil ${hours} de ore).`,
      'Dacă nu tu ai creat contul, ignoră acest mesaj.',
    ],
    link,
    cta: 'Confirmă emailul',
  };
}

export function invitationEmail({ name, link, days, companyName }) {
  return {
    subject: companyName ? `Invitație în Transitix · ${companyName}` : 'Invitație în Transitix',
    paragraphs: [
      `Salut, ${name}.`,
      companyName
        ? `Ai fost invitat în contul Transitix al firmei ${companyName}. Alege-ți parola (link valabil ${days} zile).`
        : `Ai fost invitat în Transitix. Alege-ți parola (link valabil ${days} zile).`,
    ],
    link,
    cta: 'Alege parola',
  };
}

export function resetEmail({ link }) {
  return {
    subject: 'Resetare parolă Transitix',
    paragraphs: [
      'Am primit o cerere de resetare a parolei. Linkul expiră într-o oră.',
      'Dacă nu tu ai cerut-o, ignoră acest mesaj; parola rămâne neschimbată.',
    ],
    link,
    cta: 'Resetează parola',
  };
}
