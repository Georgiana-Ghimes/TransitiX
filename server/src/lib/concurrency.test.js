import { describe, expect, it } from 'vitest';
import {
  DRIVER_ENTITY_ACTIONS,
  applyBearerFromQuery,
  entityActionFromRequest,
  entityAllowedForRole,
  isPgUniqueViolation,
  nextAvizStatusOnSave,
  nextWarehouseQty,
  repairNeedsWrite,
  safeUploadBasename,
  tripStatusForOfficeSave,
  uniqueUploadFilename,
  filenameHasCompanyPrefix,
  filenameOwnedByCompany,
  canReadUpload,
} from './concurrency.js';

describe('nextAvizStatusOnSave', () => {
  it('promotes uploaded to extracted and keeps confirmed', () => {
    expect(nextAvizStatusOnSave('uploaded')).toBe('extracted');
    expect(nextAvizStatusOnSave('extracted')).toBe('extracted');
    expect(nextAvizStatusOnSave('confirmed')).toBe('confirmed');
    expect(nextAvizStatusOnSave('confirmed', 'extracted')).toBe('confirmed');
  });
});

describe('repairNeedsWrite', () => {
  it('skips a no-op repair that would stamp updated_at over Editează', () => {
    const row = {
      numar_tpo: 'TPO-1',
      data_efectuare_cursa: '2026-08-19',
      numar_auto: 'B-1-XXX',
      ruta_transport: 'A-T-B',
      tip_marfa: 'MPI',
      cantitate_marfa: 10,
      numar_document_marfa: 'PSL-1',
    };
    expect(repairNeedsWrite(row, { ...row })).toBe(false);
    expect(repairNeedsWrite(row, { ...row, numar_tpo: 'TPO-2' })).toBe(true);
  });
});

describe('isPgUniqueViolation', () => {
  it('detects Postgres unique races for register / default template', () => {
    expect(isPgUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPgUniqueViolation({ code: '23503' })).toBe(false);
  });
});

describe('tripStatusForOfficeSave', () => {
  it('omits status when the dispatcher did not change it', () => {
    expect(tripStatusForOfficeSave('planificata', 'planificata')).toBeUndefined();
    expect(tripStatusForOfficeSave('in_tranzit', 'in_tranzit')).toBeUndefined();
  });

  it('sends status when the select actually changed', () => {
    expect(tripStatusForOfficeSave('planificata', 'alocata')).toBe('alocata');
  });
});

describe('nextWarehouseQty', () => {
  it('adds atomically from the stored value and never goes below 0', () => {
    expect(nextWarehouseQty(10, 1)).toBe(11);
    expect(nextWarehouseQty(10, -3)).toBe(7);
    expect(nextWarehouseQty(1, -5)).toBe(0);
  });
});

describe('uniqueUploadFilename', () => {
  it('does not collide when original names and timestamps match', () => {
    const a = uniqueUploadFilename('Aviz.pdf', { now: 1, id: 'aaa' });
    const b = uniqueUploadFilename('Aviz.pdf', { now: 1, id: 'bbb' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/Aviz\.pdf$/);
  });

  it('includes a uuid so parallel uploads at the same millisecond stay unique', () => {
    const names = new Set(Array.from({ length: 20 }, () => uniqueUploadFilename('Aviz.pdf', { now: 1 })));
    expect(names.size).toBe(20);
  });

  it('prefixes filenames with the company id', () => {
    const cid = '550e8400-e29b-41d4-a716-446655440000';
    const name = uniqueUploadFilename('Aviz.pdf', { now: 1, id: 'aaa', companyId: cid });
    expect(name).toBe(`c-${cid}-1-aaa-Aviz.pdf`);
    expect(filenameOwnedByCompany(name, cid)).toBe(true);
    expect(filenameOwnedByCompany(name, '11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(filenameHasCompanyPrefix(name)).toBe(true);
    expect(filenameHasCompanyPrefix('1-aaa-Aviz.pdf')).toBe(false);
  });

  it('allows prefixed files for the owner without a DB lookup', async () => {
    const cid = '550e8400-e29b-41d4-a716-446655440000';
    const name = uniqueUploadFilename('Aviz.pdf', { now: 1, id: 'aaa', companyId: cid });
    await expect(canReadUpload(async () => { throw new Error('db'); }, cid, name)).resolves.toBe(true);
    await expect(canReadUpload(async () => ({ rows: [] }), '11111111-1111-1111-1111-111111111111', name)).resolves.toBe(false);
  });

  it('checks the database for legacy unprefixed files', async () => {
    const miss = async () => ({ rows: [] });
    const hit = async () => ({ rows: [{}] });
    await expect(canReadUpload(miss, 'co-id', 'old.pdf')).resolves.toBe(false);
    await expect(canReadUpload(hit, 'co-id', 'old.pdf')).resolves.toBe(true);
  });
});

describe('safeUploadBasename', () => {
  it('rejects path traversal', () => {
    expect(safeUploadBasename('../../../etc/passwd')).toBe('passwd');
    expect(safeUploadBasename('..')).toBeNull();
    expect(safeUploadBasename('ok.pdf')).toBe('ok.pdf');
  });
});

describe('entityAllowedForRole', () => {
  it('blocks drivers from avize, invoices, vehicles, and templates', () => {
    expect(entityAllowedForRole('driver', 'AvizDocument', 'list')).toBe(false);
    expect(entityAllowedForRole('driver', 'Invoice', 'list')).toBe(false);
    expect(entityAllowedForRole('driver', 'Vehicle', 'update')).toBe(false);
    expect(entityAllowedForRole('driver', 'ReportTemplate', 'list')).toBe(false);
    expect(entityAllowedForRole('driver', 'WarehouseProduct', 'update')).toBe(false);
  });

  it('allows drivers the app surfaces they already use', () => {
    expect(entityAllowedForRole('driver', 'Trip', 'update')).toBe(true);
    expect(entityAllowedForRole('driver', 'TripDocument', 'create')).toBe(true);
    expect(entityAllowedForRole('driver', 'Driver', 'list')).toBe(true);
    expect(entityAllowedForRole('driver', 'ChatMessage', 'create')).toBe(true);
  });

  it('allows office all entities', () => {
    expect(entityAllowedForRole('admin', 'AvizDocument', 'list')).toBe(true);
    expect(entityAllowedForRole('finance', 'Invoice', 'update')).toBe(true);
  });

  it('blocks drivers from deleting and from listing office-only entities', () => {
    expect(entityAllowedForRole('driver', 'Trip', 'delete')).toBe(false);
    expect(entityAllowedForRole('driver', 'Client', 'list')).toBe(false);
    expect(entityAllowedForRole('driver', 'GPSLog', 'create')).toBe(false);
  });

  it('maps HTTP to entity actions', () => {
    expect(entityActionFromRequest('GET', '/Trip')).toBe('list');
    expect(entityActionFromRequest('GET', '/AvizDocument/abc-uuid')).toBe('get');
    expect(entityActionFromRequest('POST', '/Trip/filter')).toBe('filter');
    expect(entityActionFromRequest('PUT', '/Trip/abc')).toBe('update');
    expect(entityActionFromRequest('POST', '/WarehouseProduct/id/adjust')).toBe('update');
    expect(DRIVER_ENTITY_ACTIONS.Trip.has('update')).toBe(true);
  });
});

describe('applyBearerFromQuery', () => {
  it('uses the query token only when the header is empty', () => {
    expect(applyBearerFromQuery(null, 'abc')).toBe('Bearer abc');
    expect(applyBearerFromQuery('Bearer xyz', 'abc')).toBe('Bearer xyz');
  });
});
