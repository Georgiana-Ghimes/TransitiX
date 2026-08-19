import { describe, expect, it, vi } from 'vitest';
import { withAccessToken } from './uploadUrl.js';

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
