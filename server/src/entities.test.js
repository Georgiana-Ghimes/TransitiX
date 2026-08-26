import { describe, expect, it } from 'vitest';
import { ENTITY_MAP, parseOrder, pickWritable, serializeRow } from './entities.js';
import { DRIVER_TRIP_WRITABLE } from './lib/concurrency.js';

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

  it('limits driver trip writes to status and mileage fields', () => {
    const out = pickWritable({ writable: DRIVER_TRIP_WRITABLE }, {
      status: 'in_tranzit',
      shipper_name: 'should-not-write',
      start_mileage: 10,
      rate: 99,
    });
    expect(out.status).toBe('in_tranzit');
    expect(out.start_mileage).toBe(10);
    expect(out.shipper_name).toBeUndefined();
    expect(out.rate).toBeUndefined();
  });
});

describe('ENTITY_MAP', () => {
  it('scopes fleet entities to company', () => {
    expect(ENTITY_MAP.Vehicle.companyScoped).toBe(true);
    expect(ENTITY_MAP.Driver.companyScoped).toBe(true);
    expect(ENTITY_MAP.Client.companyScoped).toBe(true);
    expect(ENTITY_MAP.AvizDocument.companyScoped).toBe(true);
    expect(ENTITY_MAP.ReportTemplate.companyScoped).toBe(true);
  });

  it('lets office save annex fields on AvizDocument', () => {
    expect(ENTITY_MAP.AvizDocument.writable).toEqual(expect.arrayContaining([
      'numar_tpo',
      'data_efectuare_cursa',
      'numar_auto',
      'ruta_transport',
      'numar_document_marfa',
      'taxe_suplimentare',
      'km_parcursi',
      'tarif_km',
      'observatii',
      'ruta_display',
      'trip_id',
    ]));
  });

  it('keeps every calendar-day column out of the UTC path', () => {
    // pg returns DATE as *local* midnight. Anything serialized with toISOString() lands in the
    // previous evening east of Greenwich, shifting a whole column by a day — which is exactly
    // what happened to `data_facturare` on a customer's annex.
    const day = new Date(2026, 2, 31, 0, 0, 0);
    const out = serializeRow({
      id: 'x',
      data_efectuare_cursa: day,
      data_facturare: day,
      loading_date: day,
      itp_expiry: day,
    });
    for (const key of ['data_efectuare_cursa', 'data_facturare', 'loading_date', 'itp_expiry']) {
      expect(out[key], key).toBe('2026-03-31');
    }
  });

  it('lets office save the billing date apart from the trip date', () => {
    expect(ENTITY_MAP.AvizDocument.writable).toEqual(
      expect.arrayContaining(['data_efectuare_cursa', 'data_facturare'])
    );
  });

  it('lets office save UIT and trip margin fields', () => {
    expect(ENTITY_MAP.Trip.writable).toEqual(expect.arrayContaining([
      'uit_code',
      'agreed_revenue',
      'estimated_cost',
      'shipper_cui',
      'consignee_cui',
    ]));
  });
});
