import { describe, expect, it } from 'vitest';
import { MIN_LENGTH, PASSWORD_HINT, checkPassword, passwordError } from './password.js';

const ok = (pw, ctx) => checkPassword(pw, ctx).ok;

describe('length', () => {
  it('accepts a long ordinary password', () => {
    expect(ok('caisele-verzi-din-livada')).toBe(true);
  });

  it('rejects anything under the minimum', () => {
    // The old rules were six characters in one place and nothing at all in the other.
    expect(ok('scurta')).toBe(false);
    expect(ok('a')).toBe(false);
    expect(ok('')).toBe(false);
  });

  it('names the minimum rather than saying "invalid"', () => {
    expect(passwordError('abc')).toContain(String(MIN_LENGTH));
  });

  it('caps the length, to bound the hashing work per request', () => {
    expect(ok('a'.repeat(500))).toBe(false);
  });

  it('survives being handed nothing', () => {
    expect(ok(null)).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});

describe('no composition rules', () => {
  it('accepts a long passphrase with no digits or symbols', () => {
    // Demanding an uppercase, a digit and a symbol is what produces Parola1! on every account.
    expect(ok('trei camioane pleaca marti')).toBe(true);
  });

  it('does not require mixed case', () => {
    expect(ok('acoperisulcasei')).toBe(true);
  });

  it('accepts a short-but-long-enough phrase with symbols too', () => {
    expect(ok('Mere&Pere2026!')).toBe(true);
  });
});

describe('the blocklist', () => {
  it('rejects the words people reach for', () => {
    for (const bad of ['parola1234', 'password12', 'qwertyuiop', 'administrator', 'transitix1']) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it('is case-insensitive', () => {
    expect(ok('PaRoLa1234')).toBe(false);
  });

  it('does not reject a real phrase that merely contains a common word', () => {
    // "parola" inside a longer phrase is fine; only leading with it is the giveaway.
    expect(ok('nu stiu ce parola sa aleg')).toBe(true);
  });
});

describe('predictable shapes', () => {
  it('rejects one character repeated', () => {
    expect(ok('aaaaaaaaaaaa')).toBe(false);
  });

  it('rejects a straight run through the alphabet or keypad', () => {
    expect(ok('abcdefghijkl')).toBe(false);
    expect(ok('9876543210')).toBe(false);
  });

  it('rejects a short unit repeated to length', () => {
    expect(ok('abcabcabcabc')).toBe(false);
  });

  it('keeps a phrase that happens to contain a run', () => {
    expect(ok('cheia are abc pe ea')).toBe(true);
  });
});

describe('the person’s own details', () => {
  it('refuses their email', () => {
    // Long, not on any blocklist, and the first thing anybody would try.
    expect(ok('ana.pop@firma.ro', { email: 'ana.pop@firma.ro' })).toBe(false);
  });

  it('refuses their email used as part of the password', () => {
    expect(ok('ana.pop@firma.ro-2026', { email: 'ana.pop@firma.ro' })).toBe(false);
  });

  it('refuses their own name', () => {
    expect(ok('georgiana ghimes', { name: 'Georgiana Ghimes' })).toBe(false);
  });

  it('does not choke on a very short name', () => {
    // A two-letter name would otherwise reject almost everything containing those letters.
    expect(ok('caisele-verzi-din-livada', { name: 'Io' })).toBe(true);
  });

  it('works with no context at all', () => {
    expect(ok('caisele-verzi-din-livada', {})).toBe(true);
  });
});

describe('whitespace', () => {
  it('refuses a leading or trailing space', () => {
    // Almost always a paste accident, and it locks the account out of every hand-typed login.
    expect(ok(' caisele-verzi-din-livada')).toBe(false);
    expect(ok('caisele-verzi-din-livada ')).toBe(false);
  });

  it('allows spaces inside — a passphrase is the point', () => {
    expect(ok('trei mere si o para')).toBe(true);
  });
});

describe('reporting', () => {
  it('returns every problem at once rather than one at a time', () => {
    const result = checkPassword('abc', { email: 'abc@x.ro' });
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('returns null when there is nothing wrong', () => {
    expect(passwordError('caisele-verzi-din-livada')).toBeNull();
  });

  it('states the rule up front, so it is not discovered by failing it', () => {
    expect(PASSWORD_HINT).toContain(String(MIN_LENGTH));
  });
});
