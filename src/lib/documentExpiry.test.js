import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPIRY_HORIZON_DAYS,
  collectExpiringDocuments,
  expiryHorizonDays,
} from './documentExpiry.js';

const NOW = new Date('2026-08-29T12:00:00+03:00');

function inDays(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('expiryHorizonDays', () => {
  it('takes the widest configured threshold', () => {
    expect(expiryHorizonDays({ settings: { document_expiry_days: [30, 15, 7, 1] } })).toBe(30);
    expect(expiryHorizonDays({ settings: { document_expiry_days: [7, 60] } })).toBe(60);
  });

  it('falls back to 30 days when the setting is missing or unusable', () => {
    expect(expiryHorizonDays(null)).toBe(DEFAULT_EXPIRY_HORIZON_DAYS);
    expect(expiryHorizonDays({ settings: {} })).toBe(DEFAULT_EXPIRY_HORIZON_DAYS);
    expect(expiryHorizonDays({ settings: { document_expiry_days: [] } })).toBe(30);
    expect(expiryHorizonDays({ settings: { document_expiry_days: ['x', 0, -5] } })).toBe(30);
  });
});

describe('collectExpiringDocuments', () => {
  const vehicles = [
    { id: 'v1', brand: 'Scania', model: 'R450', plate: 'B-202-TRX', rovinieta_expiry: inDays(0), rovinieta_number: 'RO-1' },
    { id: 'v2', brand: 'Volvo', model: 'FH16', plate: 'B-101-TRX', rovinieta_expiry: inDays(25) },
    { id: 'v3', brand: 'MAN', model: 'TGX', plate: 'B-303-TRX', itp_expiry: inDays(120) },
  ];
  const drivers = [
    { id: 'd1', name: 'Lucan Florin Marian', tachograph_card_expiry: inDays(6), license_expiry: inDays(13) },
    { id: 'd2', name: 'Maria Ionescu', license_expiry: inDays(22) },
  ];

  it('counts vehicle and driver documents together, sorted by date', () => {
    const list = collectExpiringDocuments({ vehicles, drivers, horizonDays: 30, now: NOW });
    expect(list).toHaveLength(5);
    expect(list.map((d) => d.type)).toEqual(['Rovinietă', 'Tahograf', 'Permis', 'Permis', 'Rovinietă']);
    expect(list[0].entity).toBe('Scania R450 (B-202-TRX)');
  });

  it('labels the medical certificate as Medical, not Tahograf', () => {
    const list = collectExpiringDocuments({
      vehicles: [],
      drivers: [{ id: 'd9', name: 'Ana', medical_certificate_expiry: inDays(5) }],
      horizonDays: 30,
      now: NOW,
    });
    expect(list.map((d) => d.type)).toEqual(['Medical']);
  });

  it('honours a wider horizon from Setări', () => {
    const list = collectExpiringDocuments({ vehicles, drivers, horizonDays: 180, now: NOW });
    expect(list.map((d) => d.type)).toContain('ITP');
  });

  it('skips deactivated fleet, matching what the bell computes', () => {
    const list = collectExpiringDocuments({
      vehicles: [{ ...vehicles[0], is_active: false }],
      drivers: [{ ...drivers[0], is_active: false }],
      horizonDays: 30,
      now: NOW,
    });
    expect(list).toEqual([]);
  });

  it('flags a date in the past as expired', () => {
    const [first] = collectExpiringDocuments({
      vehicles: [{ id: 'v9', brand: 'DAF', model: 'XF', plate: 'B-9', itp_expiry: inDays(-3) }],
      drivers: [],
      horizonDays: 30,
      now: NOW,
    });
    expect(first.expired).toBe(true);
  });
});
