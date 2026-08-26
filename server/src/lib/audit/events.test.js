import { describe, expect, it, vi } from 'vitest';
import {
  AUDITED_ENTITIES,
  NOT_AUDITED,
  actorFrom,
  diffRows,
  ipFrom,
  isAudited,
  isSecretField,
  labelFor,
  presentValue,
  recordAudit,
  sameValue,
  snapshotRow,
} from './events.js';

describe('what is on the list', () => {
  it('gives every audited entity a reason', () => {
    // The reason is the test somebody must pass before adding an entry: if you cannot say who
    // would ask the question, it does not belong.
    for (const [entity, reason] of Object.entries(AUDITED_ENTITIES)) {
      expect(reason, entity).toBeTruthy();
      expect(reason.length, entity).toBeGreaterThan(10);
    }
  });

  it('gives every excluded entity a reason too', () => {
    for (const [entity, reason] of Object.entries(NOT_AUDITED)) {
      expect(reason, entity).toBeTruthy();
    }
  });

  it('never has an entity on both lists', () => {
    for (const entity of Object.keys(AUDITED_ENTITIES)) {
      expect(Object.keys(NOT_AUDITED), entity).not.toContain(entity);
    }
  });

  it('keeps the money and the pricing configuration', () => {
    for (const entity of ['ContractTariff', 'TaxZoneRate', 'SurchargeRate', 'Trip', 'Invoice']) {
      expect(isAudited(entity), entity).toBe(true);
    }
  });

  it('leaves the telemetry out', () => {
    // A row per GPS ping would bury the entries that matter and undo the retention policies.
    for (const entity of ['GPSLog', 'ChatMessage', 'DriverNotification']) {
      expect(isAudited(entity), entity).toBe(false);
    }
  });
});

describe('secrets never reach the trail', () => {
  it('recognises the obvious carriers', () => {
    for (const field of [
      'password', 'password_hash', 'refresh_token', 'api_key', 'apiKey',
      'client_secret', 'credentials', 'signature_data',
    ]) {
      expect(isSecretField(field), field).toBe(true);
    }
  });

  it('redacts the value rather than the field', () => {
    // The fact that a password was changed is exactly what an audit trail is for; the value is
    // exactly what it must not hold.
    expect(presentValue('password_hash', '$2a$12$abcdef')).toBe('«ascuns»');
  });

  it('keeps ordinary fields', () => {
    expect(isSecretField('tarif_km')).toBe(false);
    expect(presentValue('tarif_km', '2.5000')).toBe('2.5000');
  });

  it('never lets a hash through a whole-row snapshot', () => {
    const snap = snapshotRow({ id: 'u1', email: 'a@b.ro', password_hash: 'secret-hash' });
    expect(snap.password_hash).toBe('«ascuns»');
    expect(JSON.stringify(snap)).not.toContain('secret-hash');
  });

  it('replaces a blob with its size', () => {
    const snap = snapshotRow({ payload: 'x'.repeat(900) });
    expect(snap.payload).toBe('«900 caractere»');
  });
});

describe('sameValue', () => {
  it('sees through NUMERIC coming back as a string', () => {
    // pg returns NUMERIC as text: a tariff saved as 2.5 comes back "2.5000". Compared naively,
    // every save of an untouched row would look like a change.
    expect(sameValue(2.5, '2.5000')).toBe(true);
    expect(sameValue('9000.00', 9000)).toBe(true);
  });

  it('does not treat a class as a number', () => {
    // "10t" is a commercial band, not a quantity.
    expect(sameValue('10t', '10')).toBe(false);
  });

  it('does not read an emptied field as zero', () => {
    // Number('') is 0, so a field cleared from 0 would otherwise look unchanged.
    expect(sameValue(0, '')).toBe(false);
    expect(sameValue('', null)).toBe(false);
  });

  it('compares dates by instant', () => {
    const d = new Date('2026-03-31T00:00:00.000Z');
    expect(sameValue(d, new Date('2026-03-31T00:00:00.000Z'))).toBe(true);
    expect(sameValue(d, new Date('2026-04-01T00:00:00.000Z'))).toBe(false);
  });

  it('holds null equal to null and different from anything', () => {
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
  });
});

describe('diffRows', () => {
  it('reports only what moved', () => {
    const changes = diffRows(
      { id: '1', tarif_km: '2.5000', valid_from: '2026-01-01', note: 'x' },
      { id: '1', tarif_km: '2.8000', valid_from: '2026-01-01', note: 'x' }
    );
    expect(Object.keys(changes)).toEqual(['tarif_km']);
    expect(changes.tarif_km).toEqual({ from: '2.5000', to: '2.8000' });
  });

  it('ignores the bookkeeping columns', () => {
    // A changed updated_at says nothing about intent, and would make every save look like an edit.
    const changes = diffRows(
      { id: '1', name: 'A', updated_at: '2026-01-01', created_at: '2025-01-01', company_id: 'c' },
      { id: '1', name: 'A', updated_at: '2026-08-26', created_at: '2025-01-01', company_id: 'c' }
    );
    expect(changes).toEqual({});
  });

  it('catches a field the server derived rather than the client sent', () => {
    // The diff runs against the rows, not the payload, so distance_source shows up.
    const changes = diffRows(
      { distance_km: 100, distance_source: 'manual' },
      { distance_km: 112, distance_source: 'osrm' }
    );
    expect(Object.keys(changes).sort()).toEqual(['distance_km', 'distance_source']);
  });

  it('records a field being cleared', () => {
    const changes = diffRows({ uit_code: 'RO123' }, { uit_code: null });
    expect(changes.uit_code).toEqual({ from: 'RO123', to: null });
  });

  it('records a field appearing', () => {
    expect(diffRows({}, { data_facturare: '2026-03-31' }).data_facturare)
      .toEqual({ from: null, to: '2026-03-31' });
  });
});

describe('labelFor', () => {
  it('names a trip by its TPO', () => {
    expect(labelFor('Trip', { tpo_number: 'TPO 2026-0311', cmr_number: 'X' }))
      .toBe('TPO 2026-0311');
  });

  it('falls back to the CMR when there is no TPO yet', () => {
    expect(labelFor('Trip', { tpo_number: null, cmr_number: 'CMR-9' })).toBe('CMR-9');
  });

  it('names an invoice by series and number', () => {
    expect(labelFor('Invoice', { series: 'TRX', number: '104' })).toBe('TRX 104');
  });

  it('names a tariff by class and start of validity', () => {
    expect(labelFor('ContractTariff', { vehicle_class: '10t', valid_from: '2026-01-01' }))
      .toBe('10t de la 2026-01-01');
  });

  it('falls back to a name for anything else', () => {
    expect(labelFor('Client', { name: 'Baumit' })).toBe('Baumit');
  });

  it('returns null rather than an id when there is nothing readable', () => {
    // A trail that reads "ContractTariff 8f3e-…" answers nothing; the screen can say so itself.
    expect(labelFor('Client', { id: 'abc' })).toBeNull();
    expect(labelFor('Client', null)).toBeNull();
  });
});

describe('who did it', () => {
  it('flattens the user so the trail survives their deletion', () => {
    const actor = actorFrom({ user: { id: 'u1', email: 'a@b.ro', role: 'admin' }, ip: '10.0.0.1' });
    expect(actor).toMatchObject({ user_id: 'u1', user_email: 'a@b.ro', user_role: 'admin' });
  });

  it('takes only the first hop of a forwarded chain', () => {
    // The rest of an X-Forwarded-For chain is client-supplied and unverified.
    expect(ipFrom({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })).toBe('1.2.3.4');
  });

  it('falls back to the socket address', () => {
    expect(ipFrom({ headers: {}, socket: { remoteAddress: '::1' } })).toBe('::1');
  });
});

describe('recordAudit', () => {
  it('refuses an entry that names neither company nor action', async () => {
    const client = { query: vi.fn() };
    await expect(recordAudit(client, { entity: 'Trip' })).rejects.toThrow(/required/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('serialises the change map as JSON', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await recordAudit(client, {
      company_id: 'c1', action: 'update', entity: 'ContractTariff',
      changes: { tarif_km: { from: 1, to: 2 } },
    });
    const params = client.query.mock.calls[0][1];
    expect(params).toContain('{"tarif_km":{"from":1,"to":2}}');
  });
});
