import { describe, expect, it } from 'vitest';
import {
  buildInvoiceDraft,
  chargeLines,
  describeDraft,
  headerTripId,
  vatRateFor,
} from './invoiceDraft.js';

const TRIP = { id: 't1', tpo_number: 'TPO 2026-0311', cmr_number: 'CMR-1', tpo_total: 975 };
const CHARGES = [
  { id: 'c1', kind: 'trip_rate', code: 'CURSA', label: 'Tarif cursă', quantity: 1, unit_amount: 500, amount: 500 },
  { id: 'c2', kind: 'km_rate', code: 'KM', label: 'Kilometri', quantity: 112, unit_amount: 2.5, amount: 280 },
  { id: 'c3', kind: 'zone_tax', code: 'ZB', label: 'Taxă zonă B', amount: 75 },
  { id: 'c4', kind: 'surcharge', code: 'DM', label: 'Taxă macara', amount: 120 },
];

const withCharges = (...pairs) => new Map(pairs);

describe('chargeLines', () => {
  it('keeps every component as its own line', () => {
    // A customer disputes "why 120 for the crane", not "why 975".
    const lines = chargeLines(TRIP, CHARGES);
    expect(lines.map((l) => l.code)).toEqual(['CURSA', 'KM', 'ZB', 'DM']);
    expect(lines.every((l) => l.trip_id === 't1')).toBe(true);
  });

  it('carries the quantity and unit price where the engine had them', () => {
    const km = chargeLines(TRIP, CHARGES).find((l) => l.code === 'KM');
    expect(km).toMatchObject({ quantity: 112, unit_amount: 2.5, amount: 280 });
  });

  it('references the trip by its TPO, which is what appears on the annex', () => {
    expect(chargeLines(TRIP, CHARGES)[0].reference).toBe('TPO 2026-0311');
  });

  it('falls back to the CMR when there is no TPO number', () => {
    expect(chargeLines({ ...TRIP, tpo_number: null }, CHARGES)[0].reference).toBe('CMR-1');
  });
});

describe('buildInvoiceDraft', () => {
  it('bills the sum of the priced lines, not a stored guess', () => {
    const draft = buildInvoiceDraft([TRIP], withCharges(['t1', CHARGES]));
    expect(draft.subtotal).toBe(975);
    expect(draft.lines).toHaveLength(4);
    expect(draft.warnings).toEqual([]);
  });

  it('adds VAT at the given rate', () => {
    const draft = buildInvoiceDraft([TRIP], withCharges(['t1', CHARGES]), { vatRate: 19 });
    expect(draft.vat_amount).toBe(185.25);
    expect(draft.total_amount).toBe(1160.25);
  });

  it('adds nothing when the company does not charge VAT', () => {
    const draft = buildInvoiceDraft([TRIP], withCharges(['t1', CHARGES]), { vatRate: 0 });
    expect(draft.vat_amount).toBe(0);
    expect(draft.total_amount).toBe(975);
  });

  it('combines several trips into one invoice', () => {
    const second = { id: 't2', tpo_number: 'TPO 2026-0312', tpo_total: 500 };
    const draft = buildInvoiceDraft(
      [TRIP, second],
      withCharges(['t1', CHARGES], ['t2', [{ kind: 'trip_rate', label: 'Tarif cursă', amount: 500 }]])
    );
    expect(draft.subtotal).toBe(1475);
    expect(draft.lines).toHaveLength(5);
  });

  it('refuses to invent a figure for a trip nobody priced', () => {
    // The old path silently substituted the aviz column here, which is how an invoice went out
    // on a number nothing had recalculated.
    const draft = buildInvoiceDraft([TRIP], new Map());
    expect(draft.subtotal).toBe(0);
    expect(draft.lines).toEqual([]);
    expect(draft.warnings[0].code).toBe('trip_not_priced');
    expect(draft.unpriced_trip_ids).toEqual(['t1']);
  });

  it('bills what it can and names what it could not', () => {
    const second = { id: 't2', tpo_number: 'TPO 2026-0312' };
    const draft = buildInvoiceDraft([TRIP, second], withCharges(['t1', CHARGES]));
    expect(draft.subtotal).toBe(975);
    expect(draft.priced_trip_ids).toEqual(['t1']);
    expect(draft.warnings.find((w) => w.code === 'trip_not_priced').count).toBe(1);
  });

  it('reports a stored total that disagrees with its own lines', () => {
    const draft = buildInvoiceDraft([{ ...TRIP, tpo_total: 1200 }], withCharges(['t1', CHARGES]));
    const warning = draft.warnings.find((w) => w.code === 'tpo_total_mismatch');
    expect(warning.message).toContain('1200.00');
    expect(warning.message).toContain('975.00');
    // It still bills the lines: they are what the engine actually computed.
    expect(draft.subtotal).toBe(975);
  });

  it('tolerates a rounding difference below half a ban', () => {
    const draft = buildInvoiceDraft([{ ...TRIP, tpo_total: 975.004 }], withCharges(['t1', CHARGES]));
    expect(draft.warnings).toEqual([]);
  });

  it('says nothing about a total nobody stored', () => {
    const draft = buildInvoiceDraft([{ ...TRIP, tpo_total: null }], withCharges(['t1', CHARGES]));
    expect(draft.warnings).toEqual([]);
  });

  it('handles an empty selection', () => {
    const draft = buildInvoiceDraft([], new Map());
    expect(draft).toMatchObject({ subtotal: 0, total_amount: 0, lines: [] });
  });
});

describe('headerTripId', () => {
  it('names the trip when there is only one', () => {
    expect(headerTripId(['t1'])).toBe('t1');
  });

  it('leaves the header unset when the invoice spans several', () => {
    // Pinning it to whichever sorted first files the document against the wrong trip.
    expect(headerTripId(['t1', 't2'])).toBeNull();
  });

  it('ignores duplicates and blanks', () => {
    expect(headerTripId(['t1', 't1', null])).toBe('t1');
    expect(headerTripId([])).toBeNull();
  });
});

describe('describeDraft', () => {
  it('names the TPOs being billed', () => {
    expect(describeDraft([TRIP])).toBe('Servicii transport — TPO 2026-0311');
  });

  it('stops listing once the description would be unreadable', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, tpo_number: `TPO-${i}` }));
    expect(describeDraft(many)).toContain('și încă 3');
  });

  it('falls back when nothing is referenced', () => {
    expect(describeDraft([{ id: 't1' }])).toBe('Servicii transport');
  });
});

describe('vatRateFor', () => {
  it('defaults to the standard rate', () => {
    expect(vatRateFor({ vat_regime: 'platitor' })).toBe(19);
    expect(vatRateFor({})).toBe(19);
  });

  it('charges nothing for a company outside the VAT system', () => {
    // The old hard-coded 19% added VAT to everyone, including companies that must not charge it.
    expect(vatRateFor({ vat_regime: 'neplatitor' })).toBe(0);
    expect(vatRateFor({ vat_regime: 'scutit' })).toBe(0);
  });

  it('honours a configured rate', () => {
    expect(vatRateFor({ vat_regime: 'platitor', vat_rate: 9 })).toBe(9);
  });
});
