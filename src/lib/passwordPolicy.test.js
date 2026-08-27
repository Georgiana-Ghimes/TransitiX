import { describe, expect, it } from 'vitest';
import { MIN_LENGTH, PASSWORD_HINT, localPasswordError } from './passwordPolicy.js';
import {
  MIN_LENGTH as SERVER_MIN,
  PASSWORD_HINT as SERVER_HINT,
  checkPassword,
} from '../../server/src/lib/password.js';

describe('the client and the server agree on the rule', () => {
  it('shares one minimum length', () => {
    // If these drift, the form either lets through what the API rejects — the user gets a
    // failure after committing to a password — or refuses what the API would have accepted.
    expect(MIN_LENGTH).toBe(SERVER_MIN);
  });

  it('shares one wording, so the hint and the rejection do not contradict each other', () => {
    expect(PASSWORD_HINT).toBe(SERVER_HINT);
  });

  it('never accepts locally what the server would refuse on length', () => {
    const short = 'a'.repeat(MIN_LENGTH - 1);
    expect(localPasswordError(short)).toBeTruthy();
    expect(checkPassword(short).ok).toBe(false);
  });
});

describe('localPasswordError', () => {
  it('passes an acceptable password', () => {
    expect(localPasswordError('caisele-verzi-din-livada')).toBeNull();
  });

  it('asks for something when the field is empty', () => {
    expect(localPasswordError('')).toBe('Introdu o parolă.');
    expect(localPasswordError(null)).toBeTruthy();
  });

  it('names the minimum rather than saying invalid', () => {
    expect(localPasswordError('scurt')).toContain(String(MIN_LENGTH));
  });

  it('catches a pasted leading or trailing space', () => {
    expect(localPasswordError(' caisele-verzi-din-livada')).toBeTruthy();
  });

  it('checks the confirmation only when one is given', () => {
    expect(localPasswordError('caisele-verzi-din-livada', { confirm: 'altceva' }))
      .toBe('Parolele nu coincid.');
    expect(localPasswordError('caisele-verzi-din-livada', { confirm: 'caisele-verzi-din-livada' }))
      .toBeNull();
    expect(localPasswordError('caisele-verzi-din-livada')).toBeNull();
  });

  it('leaves the blocklist to the server', () => {
    // The client checks what it can answer instantly; it does not pretend to be the authority.
    expect(localPasswordError('parola1234')).toBeNull();
    expect(checkPassword('parola1234').ok).toBe(false);
  });
});
