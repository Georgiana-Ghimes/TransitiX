import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  classifyEmail,
  hashToken,
  newToken,
  passwordProblem,
  temporaryPassword,
  validateSignup,
} from './signup.js';

const good = {
  email: 'Ana@Firma-Mea.ro',
  name: 'Ana Pop',
  company_name: 'Firma Mea SRL',
  password: 'o parola destul de lunga',
  account_type: 'institution',
};

describe('classifyEmail', () => {
  it('treats a free mailbox as personal, whatever the case', () => {
    expect(classifyEmail('Ion@GMAIL.com')).toEqual({ domain: 'gmail.com', personal: true });
    expect(classifyEmail('ion@yahoo.ro').personal).toBe(true);
  });

  it('treats any other domain as the employer', () => {
    expect(classifyEmail('ion@rai-spedition.ro')).toEqual({ domain: 'rai-spedition.ro', personal: false });
  });

  it('says nothing about a string that is not an address', () => {
    expect(classifyEmail('nu-e-email')).toEqual({ domain: '', personal: false });
  });
});

describe('validateSignup', () => {
  it('accepts a complete company sign-up and normalises the address', () => {
    const res = validateSignup(good);
    expect(res.ok).toBe(true);
    expect(res.value.email).toBe('ana@firma-mea.ro');
    expect(res.value.personal).toBe(false);
  });

  it('refuses a personal address filed as a company one, and says what to do', () => {
    const res = validateSignup({ ...good, email: 'ana@gmail.com' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/Email personal/);
  });

  it('accepts the same personal address when it is declared as one', () => {
    expect(validateSignup({ ...good, email: 'ana@gmail.com', account_type: 'personal' }).ok).toBe(true);
  });

  it('reports every problem at once', () => {
    const res = validateSignup({ email: 'x', password: 'scurt' });
    expect(res.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('defaults an unknown account type to company, the stricter one', () => {
    expect(validateSignup({ ...good, account_type: 'altceva' }).value.account_type).toBe('institution');
  });
});

describe('passwordProblem', () => {
  it('requires the minimum length and nothing else', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/cel puțin/);
    expect(passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('refuses spaces at either end, a copy-paste slip that locks people out', () => {
    expect(passwordProblem(' o parola buna de tot')).toMatch(/spațiu/);
    expect(passwordProblem('o parola buna de tot ')).toMatch(/spațiu/);
    expect(passwordProblem('o parola cu spatii la mijloc')).toBeNull();
  });

  it('refuses a password that contains the address', () => {
    expect(passwordProblem('ionescu2026', { email: 'ionescu@firma.ro' })).toMatch(/email/);
  });
});

describe('tokens', () => {
  it('stores only a hash that the plaintext reproduces', () => {
    const { token, hash } = newToken();
    expect(hash).not.toBe(token);
    expect(hashToken(token)).toBe(hash);
  });
});

describe('temporaryPassword', () => {
  it('is long enough for the policy and avoids characters that read alike', () => {
    for (let i = 0; i < 50; i += 1) {
      const pwd = temporaryPassword();
      expect(passwordProblem(pwd)).toBeNull();
      expect(pwd).not.toMatch(/[0O1lI]/);
    }
  });
});
