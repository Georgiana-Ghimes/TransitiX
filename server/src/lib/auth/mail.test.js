import { afterEach, describe, expect, it } from 'vitest';
import { appLink, escapeHtml, invitationEmail, linkOrigin, publicAppOrigin } from './mail.js';

const req = (origin) => ({
  body: { origin },
  protocol: 'http',
  get: () => 'api.local:3001',
});

const savedClient = process.env.CLIENT_ORIGIN;
const savedPublic = process.env.PUBLIC_APP_ORIGIN;
afterEach(() => {
  if (savedClient === undefined) delete process.env.CLIENT_ORIGIN;
  else process.env.CLIENT_ORIGIN = savedClient;
  if (savedPublic === undefined) delete process.env.PUBLIC_APP_ORIGIN;
  else process.env.PUBLIC_APP_ORIGIN = savedPublic;
});

describe('linkOrigin', () => {
  it('uses PUBLIC_APP_ORIGIN even when the browser asked for a tunnel', () => {
    process.env.PUBLIC_APP_ORIGIN = 'https://rai-transitix.filumforge.ro';
    process.env.CLIENT_ORIGIN = 'https://rai-transitix.filumforge.ro, https://abc.trycloudflare.com';
    expect(linkOrigin(req('https://abc.trycloudflare.com'))).toBe('https://rai-transitix.filumforge.ro');
  });

  it('falls back to the first CLIENT_ORIGIN when PUBLIC_APP_ORIGIN is unset', () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    process.env.CLIENT_ORIGIN = 'https://rai-transitix.filumforge.ro, https://abc.trycloudflare.com';
    expect(linkOrigin(req('https://abc.trycloudflare.com'))).toBe('https://rai-transitix.filumforge.ro');
    expect(publicAppOrigin()).toBe('https://rai-transitix.filumforge.ro');
  });

  it('ignores an origin the server was not told about (legacy: first CLIENT_ORIGIN)', () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    process.env.CLIENT_ORIGIN = 'https://app.transitix.ro';
    expect(linkOrigin(req('https://evil.example'))).toBe('https://app.transitix.ro');
  });

  it('trusts the browser only when nothing is configured (local development)', () => {
    delete process.env.CLIENT_ORIGIN;
    delete process.env.PUBLIC_APP_ORIGIN;
    expect(linkOrigin(req('http://localhost:5173/'))).toBe('http://localhost:5173');
    expect(linkOrigin(req('javascript:alert(1)'))).toBe('http://api.local:3001');
  });

  it('puts the token in the query string, encoded', () => {
    process.env.PUBLIC_APP_ORIGIN = 'https://rai-transitix.filumforge.ro';
    expect(appLink(req(), '/reset-password', 'a b'))
      .toBe('https://rai-transitix.filumforge.ro/reset-password?token=a%20b');
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
