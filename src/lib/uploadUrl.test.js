import { describe, expect, it, vi } from 'vitest';
import {
  fetchUploadBlob,
  isUploadFileResponse,
  resolvePreviewSource,
  withAccessToken,
} from './uploadUrl.js';

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

  it('re-types the blob from Content-Type when the browser left it empty', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tok' });
    const raw = new Blob(['%PDF'], { type: '' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      blob: async () => raw,
    })));
    const out = await fetchUploadBlob('/uploads/a.pdf');
    expect(out.type).toBe('application/pdf');
    vi.unstubAllGlobals();
  });
});

describe('resolvePreviewSource', () => {
  const fileUrl = '/uploads/a.pdf';
  const tokenUrl = '/uploads/a.pdf?access_token=tok';

  it('keeps a verified PDF as a blob for the canvas viewer', () => {
    expect(resolvePreviewSource({
      kind: 'pdf', fileUrl, tokenUrl, hasVerifiedFile: true,
    })).toEqual({ mode: 'blob' });
  });

  it('does not put an unverified PDF on a token URL (SPA shell risk)', () => {
    expect(resolvePreviewSource({
      kind: 'pdf', fileUrl, tokenUrl, hasVerifiedFile: false,
    })).toEqual({ mode: 'none' });
  });

  it('prefers a blob for verified images', () => {
    expect(resolvePreviewSource({
      kind: 'image',
      fileUrl: '/uploads/a.jpg',
      tokenUrl: '/uploads/a.jpg?access_token=tok',
      hasVerifiedFile: true,
    })).toEqual({ mode: 'blob' });
  });

  it('falls back to token URL for images when Bearer fetch failed', () => {
    expect(resolvePreviewSource({
      kind: 'image',
      fileUrl: '/uploads/a.jpg',
      tokenUrl: '/uploads/a.jpg?access_token=tok',
      hasVerifiedFile: false,
    })).toEqual({ mode: 'token', url: '/uploads/a.jpg?access_token=tok' });
  });
});
