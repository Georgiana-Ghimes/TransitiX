import { describe, expect, it } from 'vitest';
import {
  actionMeta,
  changeRows,
  describeEvent,
  entityLabel,
  fieldLabel,
  formatDay,
  formatValue,
  groupByDay,
} from './auditUi';

describe('fieldLabel', () => {
  it('names the columns worth naming', () => {
    expect(fieldLabel('tarif_km')).toBe('Tarif pe km');
    expect(fieldLabel('data_facturare')).toBe('Data facturării');
  });

  it('humanises a column it does not know rather than dropping it', () => {
    // Omitting an unrecognised field would put a hole in the very thing this feature exists for.
    expect(fieldLabel('some_new_column')).toBe('Some new column');
    expect(fieldLabel('client_id')).toBe('Client');
  });

  it('survives nothing at all', () => {
    expect(fieldLabel(null)).toBe('');
  });
});

describe('formatValue', () => {
  it('keeps empty visibly different from zero', () => {
    // A blank tariff and a zero tariff are not the same thing.
    expect(formatValue(null)).toBe('—');
    expect(formatValue('')).toBe('—');
    expect(formatValue(0)).toBe('0');
  });

  it('drops the formatting zeros pg adds to NUMERIC', () => {
    expect(formatValue('2.5000')).toBe('2.5');
    expect(formatValue('9000.00')).toBe('9000');
  });

  it('shows a timestamp as the day', () => {
    expect(formatValue('2026-03-31T00:00:00.000Z')).toBe('2026-03-31');
  });

  it('translates booleans', () => {
    expect(formatValue(true)).toBe('Da');
    expect(formatValue(false)).toBe('Nu');
  });

  it('leaves a plain string alone', () => {
    expect(formatValue('TPO 2026-0311')).toBe('TPO 2026-0311');
    expect(formatValue('10t')).toBe('10t');
  });
});

describe('changeRows', () => {
  it('reads an update as from/to', () => {
    const rows = changeRows({ changes: { tarif_km: { from: '2.5000', to: '2.8000' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: 'tarif_km', from: '2.5000', to: '2.8000', paired: true });
  });

  it('reads a create or delete snapshot as plain values', () => {
    const rows = changeRows({ changes: { name: 'Baumit', cui: 'RO123' } });
    expect(rows.map((r) => r.field).sort()).toEqual(['cui', 'name']);
    expect(rows.every((r) => r.paired === false)).toBe(true);
  });

  it('keeps a field that was cleared', () => {
    // Clearing a UIT code is precisely the kind of change worth seeing.
    const rows = changeRows({ changes: { uit_code: { from: 'RO123', to: null } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].to).toBeNull();
  });

  it('drops the empty columns of a snapshot', () => {
    const rows = changeRows({ changes: { name: 'Baumit', note: null, phone: '' } });
    expect(rows.map((r) => r.field)).toEqual(['name']);
  });

  it('returns nothing rather than throwing on a login event', () => {
    expect(changeRows({ action: 'login', changes: null })).toEqual([]);
    expect(changeRows(undefined)).toEqual([]);
  });
});

describe('describeEvent', () => {
  it('says who did what', () => {
    expect(describeEvent({
      user: { name: 'Ana Pop' }, action: 'update', entity: 'ContractTariff', label: '10t',
    })).toBe('Ana Pop a modificat Tarif contractual „10t"');
  });

  it('falls back to the email', () => {
    expect(describeEvent({ user: { email: 'a@b.ro' }, action: 'create', entity: 'Client' }))
      .toContain('a@b.ro');
  });

  it('still names somebody once their account is gone', () => {
    // user_id is SET NULL when a user is deleted; the denormalised name is what survives.
    expect(describeEvent({ user: {}, action: 'delete', entity: 'Client' }))
      .toContain('Utilizator șters');
  });
});

describe('grouping', () => {
  it('buckets by day, newest day first, order kept inside a day', () => {
    const days = groupByDay([
      { created_at: '2026-08-26T10:00:00Z', id: 'a' },
      { created_at: '2026-08-26T09:00:00Z', id: 'b' },
      { created_at: '2026-08-25T18:00:00Z', id: 'c' },
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-08-26', '2026-08-25']);
    expect(days[0].events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('handles an empty log', () => {
    expect(groupByDay([])).toEqual([]);
    expect(groupByDay(null)).toEqual([]);
  });

  it('does not crash on an unparseable day', () => {
    expect(formatDay('nu-e-o-zi')).toBe('nu-e-o-zi');
  });
});

describe('labels', () => {
  it('names an action', () => {
    expect(actionMeta('login_failed').label).toBe('Autentificare eșuată');
  });

  it('shows an unknown action rather than nothing', () => {
    expect(actionMeta('ceva_nou').label).toBe('ceva_nou');
  });

  it('names an entity', () => {
    expect(entityLabel('Depot')).toBe('Garaj');
    expect(entityLabel('CevaNou')).toBe('CevaNou');
  });
});
