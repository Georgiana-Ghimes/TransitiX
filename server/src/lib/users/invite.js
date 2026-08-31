/**
 * Shared invitation helpers — tenant /users and platform GOD both create
 * accounts with an unusable password and a reset-password link.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendEmail } from '../email.js';
import {
  INVITE_TTL_HOURS,
  inviteState,
  unusablePasswordSeed,
} from './rules.js';

export function buildInviteLink(req, token) {
  const origin = req.body?.origin
    || process.env.CLIENT_ORIGIN
    || `${req.protocol}://${req.get('host')}`;
  return `${String(origin).replace(/\/$/, '')}/reset-password?token=${token}`;
}

/**
 * Sends the invitation, reporting whether it actually went.
 * Stubbed send (no Resend) counts as not sent so callers return invite_link.
 */
export async function deliverInvite({ to, name, link, companyName }) {
  const brand = companyName ? ` (${companyName})` : '';
  try {
    const result = await sendEmail({
      to,
      subject: `Invitație în Transitix${brand}`,
      text: `Salut, ${name}.\n\nAi fost invitat în Transitix${brand}. Alege-ți parola aici (link valabil `
        + `${INVITE_TTL_HOURS / 24} zile):\n${link}\n`,
      html: `<p>Salut, ${name}.</p><p>Ai fost invitat în Transitix${brand}. Alege-ți parola aici `
        + `(link valabil ${INVITE_TTL_HOURS / 24} zile):</p><p><a href="${link}">${link}</a></p>`,
    });
    return Boolean(result?.ok && !result.stub);
  } catch (err) {
    console.error('[invite email]', err.message);
    return false;
  }
}

export async function hashUnusablePassword() {
  return bcrypt.hash(unusablePasswordSeed(crypto.randomBytes(32).toString('hex')), 12);
}

export function newInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

export { INVITE_TTL_HOURS, inviteState };
