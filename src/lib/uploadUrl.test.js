import { describe, expect, it, vi } from 'vitest';
import { fetchUploadBlob, isUploadFileResponse, withAccessToken } from './uploadUrl.js';

describe('withAccessToken', () => {
  it('appends the access token on /uploads paths', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'tok',
    });
    expect(withAccessToken('/uploads/a.pdf')).toBe('/uploads/a.pdf?access_token=tok');
    expect(withAccessToken('/uploads/a.pdf?x=1')).toBe('/uploads/a.pdf?x=1&access_token=tok');
    expect(withAccessToken('/uploads/a.pdf?access_token=tok')).toBe('/uploads/a.pdf?access_token=tok');
    expect(withAccessToken('https://other/a.pdf')).toBe('https://other/a.pdf');
    vi.unstubAllGlobals();
  });
});

describe('isUploadFileResponse', () => {
  it('rejects HTML / JSON shells that look like success', () => {
    const headers = (type) => ({ get: (k) => (k.toLowerCase() === 'content-type' ? type : null) });
    expect(isUploadFileResponse({ ok: true, headers: headers('application/pdf') })).toBe(true);
    expect(isUploadFileResponse({ ok: true, headers: headers('image/jpeg') })).toBe(true);
    expect(isUploadFileResponse({ ok: true, headers: headers('text/html; charset=utf-8') })).toBe(false);
    expect(isUploadFileResponse({ ok: true, headers: headers('application/json') })).toBe(false);
    expect(isUploadFileResponse({ ok: false, headers: headers('application/pdf') })).toBe(false);
  });
});

describe('fetchUploadBlob', () => {
  it('calls fetch without putting the token in the URL', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tok' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      blob: async () => new Blob(['x']),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUploadBlob('/uploads/a.pdf?access_token=old');
    expect(fetchMock).toHaveBeenCalledWith('/uploads/a.pdf', {
      headers: { Authorization: 'Bearer tok' },
    });
    vi.unstubAllGlobals();
  });

  it('returns null when the server answered with the SPA HTML shell', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tok' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      blob: async () => new Blob(['<html>Încarcă</html>']),
    })));
    expect(await fetchUploadBlob('/uploads/missing.pdf')).toBeNull();
    vi.unstubAllGlobals();
  });
});
