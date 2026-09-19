import { afterEach, describe, expect, it } from 'vitest';
import { appLink, escapeHtml, invitationEmail, linkOrigin } from './mail.js';

const req = (origin) => ({
  body: { origin },
  protocol: 'http',
  get: () => 'api.local:3001',
});

const saved = process.env.CLIENT_ORIGIN;
afterEach(() => {
  if (saved === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = saved;
});

describe('linkOrigin', () => {
  it('ignores an origin the server was not told about', () => {
    // Otherwise a reset for somebody else's address could carry the token to this host.
    process.env.CLIENT_ORIGIN = 'https://app.transitix.ro';
    expect(linkOrigin(req('https://evil.example'))).toBe('https://app.transitix.ro');
  });

  it('accepts one of the configured origins', () => {
    process.env.CLIENT_ORIGIN = 'https://app.transitix.ro, https://rai.transitix.ro/';
    expect(linkOrigin(req('https://rai.transitix.ro'))).toBe('https://rai.transitix.ro');
  });

  it('trusts the browser only when nothing is configured (local development)', () => {
    delete process.env.CLIENT_ORIGIN;
    expect(linkOrigin(req('http://localhost:5173/'))).toBe('http://localhost:5173');
    expect(linkOrigin(req('javascript:alert(1)'))).toBe('http://api.local:3001');
  });

  it('puts the token in the query string, encoded', () => {
    process.env.CLIENT_ORIGIN = 'https://app.transitix.ro';
    expect(appLink(req(), '/verify-email', 'a b')).toBe('https://app.transitix.ro/verify-email?token=a%20b');
  });
});

describe('emails', () => {
  it('escapes what a person typed', () => {
    expect(escapeHtml('<b>"Ion"</b>')).toBe('&lt;b&gt;&quot;Ion&quot;&lt;/b&gt;');
  });

  it('names the company in an invitation when it is known', () => {
    const mail = invitationEmail({ name: 'Ana', link: 'x', days: 7, companyName: 'RAI' });
    expect(mail.subject).toContain('RAI');
    expect(mail.paragraphs.join(' ')).toContain('7 zile');
  });
});
