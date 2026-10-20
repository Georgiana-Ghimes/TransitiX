import { describe, expect, it } from 'vitest';
import {
  PRODUCT_APPS,
  allocateProductCui,
  ensureProductCompanies,
  materializeFeatureFlags,
  modulesNeedMaterialize,
} from './ensureProductCompanies.js';

function mockQuery(rowsBySql = {}) {
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    for (const [needle, rows] of Object.entries(rowsBySql)) {
      if (sql.includes(needle)) {
        const resolved = typeof rows === 'function' ? rows(params) : rows;
        return { rows: resolved };
      }
    }
    return { rows: [] };
  };
  queryFn.calls = calls;
  return queryFn;
}

describe('materializeFeatureFlags', () => {
  it('fills documents defaults including fleet when modules missing', () => {
    expect(modulesNeedMaterialize({ app_key: 'rai_documents', app_profile: 'documents' })).toBe(true);
    const f = materializeFeatureFlags({ app_key: 'rai_documents', app_profile: 'documents' });
    expect(f.modules.avize).toBe(true);
    expect(f.modules.reports).toBe(true);
    expect(f.modules.zone_map).toBe(true);
    expect(f.modules.driver_upload).toBe(true);
    expect(f.modules.fleet).toBe(true);
    expect(f.modules.users_admin).toBe(true);
    expect(f.modules.dispatch).toBe(false);
  });

  it('infers documents profile from app_key alone (no fail-open to full TMS)', () => {
    const f = materializeFeatureFlags({ app_key: 'rai_documents' });
    expect(f.app_profile).toBe('documents');
    expect(f.modules.dispatch).toBe(false);
    expect(f.modules.avize).toBe(true);
    expect(f.modules.commercial).toBe(false);
  });

  it('keeps explicit module overrides', () => {
    const f = materializeFeatureFlags({
      app_profile: 'documents',
      modules: { fleet: false, dispatch: true },
    });
    expect(f.modules.fleet).toBe(false);
    expect(f.modules.dispatch).toBe(true);
    expect(f.modules.avize).toBe(true);
  });
});

describe('allocateProductCui', () => {
  it('returns preferred CUI when free', async () => {
    const q = mockQuery({ 'WHERE cui =': [] });
    await expect(allocateProductCui(q, PRODUCT_APPS.full)).resolves.toBe('RO-TX-FULL');
  });

  it('skips taken CUIs and uses a suffix', async () => {
    const taken = new Set(['RO-TX-FULL', 'RO12345678']);
    const q = mockQuery({
      'WHERE cui =': (params) => (taken.has(params[0]) ? [{ '?column?': 1 }] : []),
    });
    await expect(allocateProductCui(q, PRODUCT_APPS.full)).resolves.toBe('RO-TX-FULL-2');
  });
});

describe('ensureProductCompanies', () => {
  it('inserts TMS with a free CUI when RAI already holds RO12345678', async () => {
    const companies = [
      {
        id: 'rai-1',
        name: 'RAI Spedition S.R.L.',
        slug: null,
        cui: 'RO12345678',
        feature_flags: { app_key: 'rai_documents', app_profile: 'documents' },
      },
    ];
    const inserted = [];

    const queryFn = async (sql, params = []) => {
      if (sql.includes('UPDATE companies c') && sql.includes("tenant_'")) {
        return { rows: [] };
      }
      if (sql.includes('AND slug = $1')) {
        const slug = params[0];
        return { rows: companies.filter((c) => c.slug === slug) };
      }
      if (sql.includes("feature_flags->>'app_key' = $1")) {
        const appKey = params[0];
        return {
          rows: companies.filter((c) => c.feature_flags?.app_key === appKey),
        };
      }
      if (sql.includes('cui = ANY')) {
        return { rows: [] };
      }
      if (sql.includes('WHERE slug = $1 LIMIT 1')) {
        return { rows: companies.filter((c) => c.slug === params[0]).map((c) => ({ id: c.id })) };
      }
      if (sql.includes('WHERE cui = $1 LIMIT 1')) {
        return { rows: companies.filter((c) => c.cui === params[0]).map(() => ({ '?column?': 1 })) };
      }
      if (sql.startsWith('UPDATE companies')) {
        const id = params[0];
        const flags = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        const row = companies.find((c) => c.id === id);
        if (row) {
          row.feature_flags = flags;
          if (params[2] != null && sql.includes('slug = $3')) row.slug = params[2];
        }
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO companies')) {
        const row = {
          id: `new-${inserted.length + 1}`,
          name: params[0],
          cui: params[1],
          slug: params[3],
          feature_flags: JSON.parse(params[4]),
        };
        companies.push(row);
        inserted.push(row);
        return { rows: [{ id: row.id, name: row.name, slug: row.slug }] };
      }
      return { rows: [] };
    };

    const result = await ensureProductCompanies(queryFn);
    expect(result.created).toHaveLength(1);
    expect(result.created[0].app_key).toBe('transitix_full');
    expect(inserted[0].cui).toBe('RO-TX-FULL');
    expect(result.updated.some((u) => u.app_key === 'rai_documents')).toBe(true);
  });
});
