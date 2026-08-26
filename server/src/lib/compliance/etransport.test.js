import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUB_PREFIX,
  buildUitDeclaration,
  etransportCapability,
  etransportConfigured,
  etransportMode,
  isStubUit,
  requestUitForRoute,
} from './etransport.js';

const ROUTE = {
  id: '11111111-1111-1111-1111-111111111111',
  route_date: '2026-08-25',
  code: 'R-001',
  vehicle_plate: 'B 123 ABC',
};
const COMPANY = { id: 'co', name: 'Transitix SRL', fiscal_code: 'RO12345' };

const KEYS = ['ETRANSPORT_MODE', 'ANAF_ETRANSPORT_URL', 'ANAF_ETRANSPORT_TOKEN'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] == null) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

describe('mode', () => {
  it('defaults to stub', () => {
    delete process.env.ETRANSPORT_MODE;
    expect(etransportMode()).toBe('stub');
    expect(etransportConfigured()).toBe(true);
  });

  it('can be turned off', () => {
    process.env.ETRANSPORT_MODE = 'off';
    expect(etransportConfigured()).toBe(false);
  });

  it('recognises the live mode under its several names', () => {
    for (const value of ['anaf', 'live', 'production']) {
      process.env.ETRANSPORT_MODE = value;
      expect(etransportMode()).toBe('anaf');
    }
  });
});

describe('the placeholder is unmistakable', () => {
  it('marks a stub code on the code itself', async () => {
    // The flag beside it gets dropped the moment the code is printed, read out, or typed into
    // another system. The string has to carry the warning.
    process.env.ETRANSPORT_MODE = 'stub';
    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.uit_code.startsWith(STUB_PREFIX)).toBe(true);
    expect(isStubUit(res.uit_code)).toBe(true);
  });

  it('says in words that the code is not valid for transport', async () => {
    process.env.ETRANSPORT_MODE = 'stub';
    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.message).toContain('NU un UIT valid');
    expect(res.stub).toBe(true);
    expect(res.source).toBe('stub');
  });

  it('does not call a real code a stub', () => {
    expect(isStubUit('RO1234567890ABCDEF')).toBe(false);
    expect(isStubUit(null)).toBe(false);
  });

  it('stays stable for the same route, so re-launching does not mint a second code', async () => {
    process.env.ETRANSPORT_MODE = 'stub';
    const a = await requestUitForRoute(ROUTE, { company: COMPANY });
    const b = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(a.uit_code).toBe(b.uit_code);
  });
});

describe('anaf mode never quietly degrades', () => {
  it('fails loudly when the credentials are missing', async () => {
    // An operator who set anaf believes real codes are being issued. Handing back a placeholder
    // here is exactly how a fake UIT reaches a roadside check.
    process.env.ETRANSPORT_MODE = 'anaf';
    delete process.env.ANAF_ETRANSPORT_URL;
    delete process.env.ANAF_ETRANSPORT_TOKEN;

    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.uit_code).toBeUndefined();
    expect(res.message).toContain('lipsesc');
  });

  it('reports itself as unconfigured rather than as working', () => {
    process.env.ETRANSPORT_MODE = 'anaf';
    delete process.env.ANAF_ETRANSPORT_TOKEN;
    expect(etransportCapability()).toBe('anaf-unconfigured');
  });

  it('reads the UIT out of an ANAF response', async () => {
    process.env.ETRANSPORT_MODE = 'anaf';
    process.env.ANAF_ETRANSPORT_URL = 'https://anaf.example/etransport';
    process.env.ANAF_ETRANSPORT_TOKEN = 'token';
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ UIT: 'RO9988776655443322' }),
    }));

    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res).toMatchObject({ ok: true, uit_code: 'RO9988776655443322', source: 'anaf', stub: false });
    expect(isStubUit(res.uit_code)).toBe(false);
  });

  it('reports an ANAF refusal instead of inventing a code', async () => {
    process.env.ETRANSPORT_MODE = 'anaf';
    process.env.ANAF_ETRANSPORT_URL = 'https://anaf.example/etransport';
    process.env.ANAF_ETRANSPORT_TOKEN = 'token';
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ mesaj: 'CIF invalid' }),
    }));

    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.uit_code).toBeUndefined();
    expect(res.message).toContain('CIF invalid');
  });

  it('survives ANAF being unreachable', async () => {
    process.env.ETRANSPORT_MODE = 'anaf';
    process.env.ANAF_ETRANSPORT_URL = 'https://anaf.example/etransport';
    process.env.ANAF_ETRANSPORT_TOKEN = 'token';
    vi.stubGlobal('fetch', async () => { throw new Error('timeout'); });

    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('inaccesibil');
  });

  it('says so when ANAF answers without a UIT', async () => {
    process.env.ETRANSPORT_MODE = 'anaf';
    process.env.ANAF_ETRANSPORT_URL = 'https://anaf.example/etransport';
    process.env.ANAF_ETRANSPORT_TOKEN = 'token';
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }));

    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
  });
});

describe('off mode', () => {
  it('returns nothing at all, and says why', async () => {
    process.env.ETRANSPORT_MODE = 'off';
    const res = await requestUitForRoute(ROUTE, { company: COMPANY });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('none');
    expect(res.uit_code).toBeUndefined();
  });
});

describe('buildUitDeclaration', () => {
  it('names the declarant by fiscal code', () => {
    const decl = buildUitDeclaration(ROUTE, { company: COMPANY });
    expect(decl.codDeclarant).toBe('RO12345');
    expect(decl.nrVehicul).toBe('B 123 ABC');
    expect(decl.dataTransport).toBe('2026-08-25');
  });

  it('counts the unloading points', () => {
    const decl = buildUitDeclaration(ROUTE, {
      company: COMPANY,
      stops: [
        { name: 'Fabrica', kind: 'incarcare' },
        { name: 'Depozit A', kind: 'livrare' },
        { name: 'Depozit B', kind: 'livrare' },
      ],
    });
    expect(decl.locStart).toBe('Fabrica');
    expect(decl.locFinal).toBe('Depozit B');
    expect(decl.nrPuncteDescarcare).toBe(2);
  });

  it('leaves a field null rather than inventing it', () => {
    const decl = buildUitDeclaration({}, {});
    expect(decl.codDeclarant).toBeNull();
    expect(decl.nrVehicul).toBeNull();
  });
});
