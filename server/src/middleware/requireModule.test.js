import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db.js';
import { requireModule, requireEntityModule, requireAnyModule } from './requireModule.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('requireModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows when module is on for documents company', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { avize: true, dispatch: false },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' } };
    const res = mockRes();
    let next = false;
    await requireModule('avize')(req, res, () => { next = true; });
    expect(next).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('blocks when module is off', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { avize: true, dispatch: false },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' } };
    const res = mockRes();
    let next = false;
    await requireModule('dispatch')(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('MODULE_DISABLED');
    expect(res.body.module).toBe('dispatch');
  });

  it('blocks platform_admin on tenant module mounts', async () => {
    const req = { user: { company_id: 'plat', role: 'platform_admin' } };
    const res = mockRes();
    let next = false;
    await requireModule('avize')(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requireEntityModule maps Vehicle → fleet', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { fleet: false, avize: true },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' }, params: { entity: 'Vehicle' } };
    const res = mockRes();
    let next = false;
    await requireEntityModule(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.body.module).toBe('fleet');
  });

  it('requireAnyModule allows when one of the keys is on', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { zone_map: true, commercial: false },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' } };
    const res = mockRes();
    let next = false;
    await requireAnyModule('zone_map', 'commercial')(req, res, () => { next = true; });
    expect(next).toBe(true);
  });

  it('requireEntityModule allows TaxZone when commercial is off but zone_map is on', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { zone_map: true, commercial: false, avize: true },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' }, params: { entity: 'TaxZone' } };
    const res = mockRes();
    let next = false;
    await requireEntityModule(req, res, () => { next = true; });
    expect(next).toBe(true);
  });

  it('requireEntityModule blocks TaxZone when only avize is on', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { zone_map: false, commercial: false, avize: true },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' }, params: { entity: 'TaxZone' } };
    const res = mockRes();
    let next = false;
    await requireEntityModule(req, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.module).toBe('zone_map');
  });

  it('requireEntityModule allows ObservationCode when avize is on', async () => {
    query.mockResolvedValue({
      rows: [{
        feature_flags: {
          app_profile: 'documents',
          modules: { avize: true, commercial: false },
        },
      }],
    });
    const req = { user: { company_id: 'c1', role: 'admin' }, params: { entity: 'ObservationCode' } };
    const res = mockRes();
    let next = false;
    await requireEntityModule(req, res, () => { next = true; });
    expect(next).toBe(true);
  });
});
