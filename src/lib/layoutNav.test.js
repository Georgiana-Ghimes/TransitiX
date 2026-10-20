import { describe, expect, it } from 'vitest';
import { mergeDocumentsNav, navGroupActive, navPathActive } from './layoutNav.js';

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
        { path: '/drivers' },
      ],
    };
    expect(navGroupActive('/fleet', group)).toBe(true);
    expect(navGroupActive('/fleet/itp', group)).toBe(true);
    expect(navGroupActive('/drivers', group)).toBe(true);
    expect(navGroupActive('/avize', group)).toBe(false);
  });
});

describe('mergeDocumentsNav', () => {
  const companion = [
    { label: 'Avize', path: '/avize', module: 'avize' },
    {
      label: 'Flotă',
      path: '/fleet',
      module: 'fleet',
      children: [{ path: '/fleet' }, { path: '/drivers' }],
    },
  ];
  const full = [
    { label: 'Dashboard', path: '/' },
    { label: 'Dispecerat', path: '/dispatch', module: 'dispatch' },
    { label: 'Curse', path: '/trips', module: 'trips' },
    { label: 'Flotă TMS', path: '/vehicles', module: 'fleet' },
    { label: 'Avize', path: '/avize', module: 'avize' },
  ];

  it('keeps companion shell and adds only enabled extras', () => {
    const on = new Set(['dispatch']);
    const nav = mergeDocumentsNav(companion, full, (m) => on.has(m));
    expect(nav.map((i) => i.path)).toEqual(['/avize', '/fleet', '/dispatch']);
  });

  it('omits extras when modules are off', () => {
    const nav = mergeDocumentsNav(companion, full, () => false);
    expect(nav.map((i) => i.path)).toEqual(['/avize', '/fleet']);
  });
});
