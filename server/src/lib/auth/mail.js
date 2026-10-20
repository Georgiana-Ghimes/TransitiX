/**
 * Account emails: verification, invitation, password reset.
 *
 * Two things every one of them has to get right:
 *
 * - **Where the link points.** Reset / invite / verify links must open a **stable** public app
 *   host (prod), not whatever Cloudflare quick-tunnel or localhost the operator clicked from.
 *   Prefer `PUBLIC_APP_ORIGIN`; else the first entry of `CLIENT_ORIGIN` (canonical). Request
 *   `origin` is never used for the email URL when either is set — CORS can still list tunnels
 *   in `CLIENT_ORIGIN`, but the token must not land on a URL that dies overnight.
 *   Without both (local bare API), the browser origin / Host header is accepted.
 * - **Whether it went.** `sendEmail` resolves happily with no provider configured. A stubbed send
 *   is reported as not sent, so the caller can hand the link over instead of waiting for nothing.
 */
import { sendEmail } from '../email.js';

function splitOrigins(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function allowedOrigins() {
  return splitOrigins(process.env.CLIENT_ORIGIN);
}

/** Stable host for password / invite / verify links (never an ephemeral tunnel). */
export function publicAppOrigin() {
  const dedicated = splitOrigins(process.env.PUBLIC_APP_ORIGIN);
  if (dedicated[0]) return dedicated[0];
  const allowed = allowedOrigins();
  return allowed[0] || '';
}

export function linkOrigin(req) {
  const canonical = publicAppOrigin();
  if (canonical) return canonical;
  const asked = String(req?.body?.origin || '').trim().replace(/\/$/, '');
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
