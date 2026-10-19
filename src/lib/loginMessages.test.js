import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from './loginMessages.js';

const apiErr = (status, { code, message } = {}) => Object.assign(new Error(message || ''), {
  status,
  data: { code, message },
  message,
});

describe('loginErrorMessage', () => {
  it('shows wrong email/password, not session expired', () => {
    expect(loginErrorMessage(apiErr(401, {
      code: 'INVALID_CREDENTIALS',
      message: 'Email sau parolă greșite. Verifică datele și încearcă din nou.',
    }))).toMatch(/Email sau parolă greșite/);
  });

  it('names a disabled account', () => {
    expect(loginErrorMessage(apiErr(403, {
      code: 'ACCOUNT_DISABLED',
      message: 'Contul este dezactivat. Contactează administratorul firmei.',
    }))).toMatch(/dezactivat/);
  });

  it('keeps the email-not-verified sentence', () => {
    expect(loginErrorMessage(apiErr(403, {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Adresa de email nu este confirmată încă. Deschide linkul primit pe email sau cere altul.',
    }))).toMatch(/nu este confirmată/);
  });

  it('keeps Google invite wording from the server', () => {
    const msg = 'Există deja conturi pe @firma.ro, dar nu pentru a@firma.ro. Cere o invitație.';
    expect(loginErrorMessage(apiErr(403, { code: 'GOOGLE_NEEDS_INVITE', message: msg }))).toBe(msg);
  });

  it('names rate limiting', () => {
    expect(loginErrorMessage(apiErr(429, {
      message: 'Prea multe încercări. Reîncearcă mai târziu.',
    }))).toMatch(/Prea multe/);
  });

  it('names a lost connection clearly', () => {
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toMatch(/contacta serverul/i);
  });

  it('does not turn a credential 401 without code into session-expired', () => {
    expect(loginErrorMessage(apiErr(401, {
      message: 'Email sau parolă greșite.',
    }))).toMatch(/Email sau parolă greșite/);
  });
});
