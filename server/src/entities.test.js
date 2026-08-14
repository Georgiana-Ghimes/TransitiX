import { describe, expect, it } from 'vitest';
import { ENTITY_MAP, parseOrder, pickWritable, serializeRow } from './entities.js';

describe('parseOrder', () => {
  it('defaults to created_at DESC', () => {
    expect(parseOrder()).toBe('created_at DESC');
    expect(parseOrder(null)).toBe('created_at DESC');
  });

  it('maps created_date alias', () => {
    expect(parseOrder('-created_date')).toBe('created_at DESC');
    expect(parseOrder('created_date')).toBe('created_at ASC');
  });

  it('rejects unsafe column names', () => {
    expect(parseOrder('-id; DROP TABLE users')).toBe('created_at DESC');
  });
});

describe('serializeRow', () => {
  it('adds created_date alias and formats dates', () => {
    const row = serializeRow({
      created_at: new Date('2026-08-14T10:00:00.000Z'),
      loading_date: new Date('2026-08-14T00:00:00.000Z'),
      weight_kg: '12500',
    });
    expect(row.created_date).toBe('2026-08-14');
    expect(row.created_at).toBe('2026-08-14T10:00:00.000Z');
    expect(row.loading_date).toBe('2026-08-14');
    expect(row.weight_kg).toBe(12500);
  });
});

describe('pickWritable', () => {
  it('keeps only entity writable fields', () => {
    const cfg = ENTITY_MAP.Vehicle;
    const out = pickWritable(cfg, {
      plate: 'B-123-TRX',
      brand: 'Volvo',
      hacker: 'nope',
      is_active: false,
    });
    expect(out.plate).toBe('B-123-TRX');
    expect(out.is_active).toBe(false);
    expect(out.hacker).toBeUndefined();
  });

  it('converts empty strings to null', () => {
    const cfg = ENTITY_MAP.Client;
    const out = pickWritable(cfg, { name: 'Acme', cui: '' });
    expect(out.cui).toBeNull();
  });
});

describe('ENTITY_MAP', () => {
  it('scopes fleet entities to company', () => {
    expect(ENTITY_MAP.Vehicle.companyScoped).toBe(true);
    expect(ENTITY_MAP.Driver.companyScoped).toBe(true);
    expect(ENTITY_MAP.Client.companyScoped).toBe(true);
  });
});
