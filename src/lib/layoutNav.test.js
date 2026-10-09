import { describe, expect, it } from 'vitest';
import { navGroupActive, navPathActive } from './layoutNav.js';

describe('navPathActive', () => {
  it('treats /fleet as exact so Autoturisme is not active on ITP', () => {
    expect(navPathActive('/fleet', '/fleet')).toBe(true);
    expect(navPathActive('/fleet/', '/fleet')).toBe(true);
    expect(navPathActive('/fleet/itp', '/fleet')).toBe(false);
    expect(navPathActive('/fleet/itp', '/fleet/itp')).toBe(true);
  });

  it('marks Flotă group active on either child', () => {
    const group = {
      path: '/fleet',
      children: [
        { path: '/fleet' },
        { path: '/fleet/itp' },
      ],
    };
    expect(navGroupActive('/fleet', group)).toBe(true);
    expect(navGroupActive('/fleet/itp', group)).toBe(true);
    expect(navGroupActive('/avize', group)).toBe(false);
  });
});
