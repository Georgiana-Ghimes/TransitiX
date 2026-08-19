import { describe, expect, it } from 'vitest';
import {
  DRIVER_ENTITY_ACTIONS,
  applyBearerFromQuery,
  entityActionFromRequest,
  entityAllowedForRole,
  isPgUniqueViolation,
  mergeReextractRow,
  nextAvizStatusOnSave,
  nextWarehouseQty,
  repairNeedsWrite,
  safeUploadBasename,
  tripStatusForOfficeSave,
  uniqueUploadFilename,
} from './concurrency.js';

describe('mergeReextractRow', () => {
  it('keeps office km/taxe/observatii when re-extracting', () => {
    const merged = mergeReextractRow(
      {
        km_parcursi: 120,
        taxe_suplimentare: 100,
        tarif_km: 20,
        observatii: 'Z:B*',
        valoare_tpo: 50,
        numar_curse: 2,
      },
      {
        numar_tpo: 'TPO-1',
        km_parcursi: 0,
        taxe_suplimentare: 0,
        tarif_km: 0,
        observatii: null,
        valoare_tpo: 0,
        numar_curse: 1,
      }
    );
    expect(merged.numar_tpo).toBe('TPO-1');
    expect(merged.km_parcursi).toBe(120);
    expect(merged.taxe_suplimentare).toBe(100);
    expect(merged.tarif_km).toBe(20);
    expect(merged.observatii).toBe('Z:B*');
    expect(merged.valoare_tpo).toBe(50);
    expect(merged.numar_curse).toBe(2);
  });

  it('fills office fields from extract when they were empty', () => {
    const merged = mergeReextractRow(
      { km_parcursi: 0, observatii: '' },
      { km_parcursi: 0, observatii: null, numar_tpo: 'TPO-2' }
    );
    expect(merged.numar_tpo).toBe('TPO-2');
    expect(merged.km_parcursi).toBe(0);
  });
});

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
