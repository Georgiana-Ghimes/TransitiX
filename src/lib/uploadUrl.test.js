import { describe, expect, it, vi } from 'vitest';
import { fetchUploadBlob, withAccessToken } from './uploadUrl.js';

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

describe('fetchUploadBlob', () => {
  it('calls fetch without putting the token in the URL', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tok' });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUploadBlob('/uploads/a.pdf?access_token=old');
    expect(fetchMock).toHaveBeenCalledWith('/uploads/a.pdf', {
      headers: { Authorization: 'Bearer tok' },
    });
    vi.unstubAllGlobals();
  });
});
