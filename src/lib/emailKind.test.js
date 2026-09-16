import { describe, expect, it } from 'vitest';
import * as server from '../../server/src/lib/auth/signup.js';
import {
  PASSWORD_MIN_LENGTH,
  PERSONAL_EMAIL_DOMAINS,
  classifyEmail,
  inviteEmailNotices,
  passwordProblem,
  signupEmailNotices,
} from './emailKind.js';

const codes = (list) => list.map((n) => n.code);

describe('the browser mirror', () => {
  it('knows the same personal domains as the server', () => {
    expect(PERSONAL_EMAIL_DOMAINS).toEqual(server.PERSONAL_EMAIL_DOMAINS);
  });

  it('asks for the same password minimum', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(server.PASSWORD_MIN_LENGTH);
  });

  it('refuses the same passwords', () => {
    for (const [pwd, email] of [['scurt', ''], ['ionescu-2026', 'ionescu@x.ro'], ['destul de lunga', 'a@b.ro'], [' cu spatiu la inceput', '']]) {
      expect(passwordProblem(pwd, { email }), pwd).toBe(server.passwordProblem(pwd, { email }));
    }
  });

  it('classifies the same way', () => {
    for (const email of ['a@GMAIL.com', 'b@firma.ro', 'nimic']) {
      expect(classifyEmail(email)).toEqual(server.classifyEmail(email));
    }
  });
});

describe('signupEmailNotices', () => {
  it('says nothing about an empty field', () => {
    expect(signupEmailNotices('', 'institution')).toEqual([]);
  });

  it('blocks a personal address declared as the company one', () => {
    const notices = signupEmailNotices('ana@gmail.com', 'institution');
    expect(codes(notices)).toEqual(['personal_as_institution']);
    expect(notices[0].level).toBe('error');
  });

  it('only warns about a company address declared as personal', () => {
    const notices = signupEmailNotices('ana@firma.ro', 'personal');
    expect(notices[0]).toMatchObject({ code: 'institution_as_personal', level: 'warning' });
  });

  it('prefers "taken" over "domain in use"', () => {
    expect(codes(signupEmailNotices('ana@firma.ro', 'institution', { email_taken: true, domain_in_use: true })))
      .toEqual(['taken']);
    expect(codes(signupEmailNotices('ana@firma.ro', 'institution', { domain_in_use: true })))
      .toEqual(['domain_in_use']);
  });

  it('stops at a malformed address', () => {
    expect(codes(signupEmailNotices('ana@', 'institution'))).toEqual(['invalid']);
  });
});

describe('inviteEmailNotices', () => {
  it('flags a personal address', () => {
    expect(codes(inviteEmailNotices('ion@yahoo.com', { adminEmail: 'sef@firma.ro' }))).toEqual(['personal']);
  });

  it('flags a different company domain', () => {
    expect(codes(inviteEmailNotices('ion@alta.ro', { adminEmail: 'sef@firma.ro' }))).toEqual(['other_domain']);
  });

  it('is quiet for a colleague on the same domain, or when the admin uses a personal address', () => {
    expect(inviteEmailNotices('ion@firma.ro', { adminEmail: 'sef@firma.ro' })).toEqual([]);
    expect(inviteEmailNotices('ion@firma.ro', { adminEmail: 'sef@gmail.com' })).toEqual([]);
  });
});
