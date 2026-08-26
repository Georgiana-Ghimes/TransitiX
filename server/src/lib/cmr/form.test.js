import { describe, expect, it } from 'vitest';
import {
  CMR_BOXES,
  SIGNATURES,
  boxesForStage,
  cmrCompleteness,
  conflictsWithScan,
  getBox,
  mergeCmr,
  prefillFromTrip,
  sanitiseCmr,
  validateCmr,
} from './form.js';

const TRIP = {
  id: 'trip-1',
  cmr_number: 'CMR-2026-0311',
  shipper_name: 'Baumit Romania SRL',
  shipper_address: 'Str. Fabricii 1, Chiajna',
  consignee_name: 'Depozit Chiajna SRL',
  consignee_address: 'Str. Depozitelor 5, Chiajna',
  loading_date: '2026-03-10',
  goods_description: 'Mortar uscat',
  gross_weight_kg: 9000,
  package_count: 18,
};

const COMPANY = { name: 'Transitix SRL', address: 'Bd. Unirii 1', cui: 'RO12345', city: 'București' };

const SIGNED = {
  semnatura_expeditor: '/uploads/a.png',
  semnatura_transportator: '/uploads/b.png',
};

// ------------------------------------------------------------------ prefill

describe('prefillFromTrip', () => {
  it('fills what the office already typed, so the note cannot disagree with the order', () => {
    const data = prefillFromTrip(TRIP, COMPANY);
    expect(data.expeditor).toBe('Baumit Romania SRL\nStr. Fabricii 1, Chiajna');
    expect(data.destinatar).toContain('Depozit Chiajna SRL');
    expect(data.natura_marfii).toBe('Mortar uscat');
    expect(data.greutate_bruta_kg).toBe(9000);
  });

  it('names the carrier from the company, with its CUI', () => {
    expect(prefillFromTrip(TRIP, COMPANY).transportator).toContain('CUI RO12345');
  });

  it('falls back to the legacy weight column when the new one is unset', () => {
    expect(prefillFromTrip({ ...TRIP, gross_weight_kg: null, weight_kg: 7000 }, COMPANY)
      .greutate_bruta_kg).toBe(7000);
  });

  it('leaves a box blank rather than inventing it', () => {
    const data = prefillFromTrip({ id: 'x' }, {});
    expect(data.expeditor).toBeNull();
    expect(data.natura_marfii).toBeNull();
  });

  it('accepts a Date for the loading date, because pg returns one', () => {
    const data = prefillFromTrip({ ...TRIP, loading_date: new Date('2026-03-10T00:00:00Z') }, COMPANY);
    expect(data.loc_data_incarcare).toContain('2026-03-10');
  });

  it('turns a pg NUMERIC string into a number', () => {
    // pg hands NUMERIC back as a string. Left alone, the weight box would carry "9000.00" —
    // shown that way on the driver's form and stored that way in the note.
    const data = prefillFromTrip({ ...TRIP, gross_weight_kg: '9000.00' }, COMPANY);
    expect(data.greutate_bruta_kg).toBe(9000);
  });

  it('reads a DATE as the local calendar day, not the UTC one', () => {
    // pg returns a DATE as local midnight. `toISOString()` on that lands in the previous
    // evening east of Greenwich, and the note would carry the day before the load.
    const localMidnight = new Date(2026, 2, 10, 0, 0, 0);
    const data = prefillFromTrip({ ...TRIP, loading_date: localMidnight }, COMPANY);
    expect(data.loc_data_incarcare).toContain('2026-03-10');
    expect(data.intocmit_data).toBe('2026-03-10');
  });
});

// ------------------------------------------------------------------- merge

describe('mergeCmr', () => {
  it('lets what the driver typed win over the prefill', () => {
    const merged = mergeCmr(prefillFromTrip(TRIP, COMPANY), { natura_marfii: 'Adeziv' });
    expect(merged.natura_marfii).toBe('Adeziv');
  });

  it('keeps a box the driver deliberately cleared cleared', () => {
    // Re-applying the prefill over an emptied box would silently undo the correction.
    const merged = mergeCmr(prefillFromTrip(TRIP, COMPANY), { natura_marfii: null });
    expect(merged.natura_marfii).toBeNull();
  });

  it('returns the prefill when nothing has been written yet', () => {
    expect(mergeCmr({ a: 1 }, null)).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------- sanitise

describe('sanitiseCmr', () => {
  it('drops fields that are not CMR boxes', () => {
    expect(sanitiseCmr({ natura_marfii: 'X', is_confirmed: true, company_id: 'other' }))
      .toEqual({ natura_marfii: 'X' });
  });

  it('reads a Romanian decimal in the weight box', () => {
    expect(sanitiseCmr({ greutate_bruta_kg: '9 000,5' }).greutate_bruta_kg).toBe(9000.5);
  });

  it('keeps a package count whole', () => {
    expect(sanitiseCmr({ numar_colete: '18,4' }).numar_colete).toBe(18);
  });

  it('turns unreadable numbers into nothing rather than zero', () => {
    // A zero here would read as "weighed, and it was empty".
    expect(sanitiseCmr({ greutate_bruta_kg: 'multe' }).greutate_bruta_kg).toBeNull();
  });

  it('rejects a date that is not a date', () => {
    expect(sanitiseCmr({ intocmit_data: 'ieri' }).intocmit_data).toBeNull();
  });

  it('leaves untouched boxes out of the patch entirely', () => {
    expect(sanitiseCmr({})).toEqual({});
  });
});

// ---------------------------------------------------------------- validate

describe('validateCmr', () => {
  const full = {
    numar_colete: 18,
    natura_marfii: 'Mortar uscat',
    greutate_bruta_kg: 9000,
  };

  it('accepts a complete, signed loading', () => {
    expect(validateCmr(full, { stage: 'incarcare', signatures: SIGNED }).ok).toBe(true);
  });

  it('refuses to sign a loading with no weight', () => {
    const check = validateCmr({ ...full, greutate_bruta_kg: null }, { stage: 'incarcare', signatures: SIGNED });
    expect(check.ok).toBe(false);
    expect(check.missing.map((m) => m.id)).toContain('greutate_bruta_kg');
  });

  it('refuses to sign a loading with a signature missing', () => {
    const check = validateCmr(full, { stage: 'incarcare', signatures: { semnatura_expeditor: '/uploads/a.png' } });
    expect(check.missing.map((m) => m.id)).toContain('semnatura_transportator');
  });

  it('names every missing box at once, not one at a time', () => {
    const check = validateCmr({}, { stage: 'incarcare', signatures: {} });
    expect(check.missing).toHaveLength(5);
  });

  it('does not ask for loading boxes when checking the delivery', () => {
    const check = validateCmr({}, { stage: 'livrare', signatures: { semnatura_destinatar: '/uploads/c.png' } });
    expect(check.ok).toBe(true);
  });

  it('needs the consignee signature to close the delivery', () => {
    expect(validateCmr(full, { stage: 'livrare', signatures: SIGNED }).ok).toBe(false);
  });

  it('treats whitespace as empty', () => {
    const check = validateCmr({ ...full, natura_marfii: '   ' }, { stage: 'incarcare', signatures: SIGNED });
    expect(check.missing.map((m) => m.id)).toContain('natura_marfii');
  });
});

// ------------------------------------------------------------------ shape

describe('form shape', () => {
  it('asks the driver only for what the driver can see', () => {
    const prefilled = CMR_BOXES.filter((b) => b.stage === 'prefill').map((b) => b.id);
    expect(prefilled).toEqual(expect.arrayContaining(['expeditor', 'destinatar', 'transportator']));
  });

  it('makes the weight box mandatory, like the rest of the system assumes', () => {
    expect(getBox('greutate_bruta_kg').required).toBe(true);
  });

  it('has a reservations box for each stage, which is what matters when goods are damaged', () => {
    expect(getBox('rezerve_incarcare')).not.toBeNull();
    expect(getBox('rezerve_livrare')).not.toBeNull();
  });

  it('orders a stage by box number, the way the paper form reads', () => {
    const boxes = boxesForStage('incarcare').map((b) => b.box);
    expect(boxes).toEqual([...boxes].sort((a, b) => a - b));
  });

  it('gives every box a label', () => {
    expect(CMR_BOXES.every((b) => b.label)).toBe(true);
    expect(SIGNATURES.every((s) => s.label)).toBe(true);
  });

  it('returns nothing for a box that does not exist', () => {
    expect(getBox('inventat')).toBeNull();
  });
});

describe('cmrCompleteness', () => {
  it('counts what is written', () => {
    const data = prefillFromTrip(TRIP, COMPANY);
    const { filled, total } = cmrCompleteness(data);
    expect(total).toBe(CMR_BOXES.length);
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(total);
  });

  it('can count one stage at a time', () => {
    expect(cmrCompleteness({}, 'livrare').total).toBe(1);
  });
});

describe('conflictsWithScan', () => {
  it('says a photographed CMR is already the note for that trip', () => {
    expect(conflictsWithScan({ original_image_url: '/uploads/x.jpg', source: 'scan' })).toBe(true);
  });

  it('does not count a written note as a scan', () => {
    expect(conflictsWithScan({ source: 'digital', cmr_data: {} })).toBe(false);
  });

  it('handles a trip with no document yet', () => {
    expect(conflictsWithScan(null)).toBe(false);
  });
});
