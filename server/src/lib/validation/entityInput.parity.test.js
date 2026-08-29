import { describe, expect, it } from 'vitest';
import { validateEntityInput, validatorFor, VALIDATED_ENTITIES } from './entityInput.js';
import {
  validateClient,
  validateDriver,
  validateInvoice,
  validateWarehouseProduct,
  normalizeClient,
  normalizeDriver,
  normalizeInvoice,
  normalizeWarehouseProduct,
} from '../../../../src/lib/entityValidation.js';

const CLIENT_CASES = [
  { name: '   ' },
  { name: '\t\n ' },
  { name: 'A' },
  { name: 'Baumit România', cui: 'RO12345678', email: 'a@b.ro', phone: '0722 123 456' },
  { name: 'Baumit', email: 'asd' },
  { name: 'Baumit', phone: '1' },
  { name: 'Baumit', cui: 'nu-i CUI' },
  // The same column carries foreign VAT ids; a Romanian-only shape would refuse real partners.
  { name: 'Baumit', cui: 'ATU12345678' },
  { name: 'Baumit', cui: 'IE1234567FA' },
  { name: 'Baumit', cui: 'RO1' },
  { name: '###' },
  { name: 'Ok', contact_person: '   ' },
];

const DRIVER_CASES = [
  { name: 'Lucan Florin Marian', phone: '0722123456' },
  { name: 'a', phone: '0722123456' },
  { name: 'Lucan Florin', phone: '1' },
  { name: 'Lucan Florin', phone: '0722123456', email: 'asd' },
  { name: 'Lucan Florin', phone: '0722123456', license_number: '-32133131' },
  { name: 'Lucan Florin', phone: '0722123456', license_category: 'text arbitrar' },
  { name: 'Lucan Florin', phone: '0722123456', license_number: 'B123456', license_expiry: '' },
  { name: 'Lucan Florin', phone: '0722123456', birth_date: '2999-01-01' },
  { name: 'Lucan Florin', phone: '0722123456', shift_start: '08:00', shift_end: '08:00' },
];

const INVOICE_CASES = [
  { client_name: '   ', issue_date: '2026-08-29' },
  { client_name: 'Baumit', issue_date: '' },
  { client_name: 'Baumit', issue_date: '2026-08-29', due_date: '2026-08-01' },
  { client_name: 'Baumit', issue_date: '2026-08-29', vat_rate: 500 },
  { client_name: 'Baumit', issue_date: '2026-08-29', series: 'TRX', subtotal: '1200.50' },
];

const PRODUCT_CASES = [
  { sku: '', name: 'Ceva' },
  { sku: '"D"SA"o-| ჩ௵', name: '„666:]q O' },
  { sku: 'PAL-EUR-120', name: 'P' },
  { sku: 'PAL-EUR-120', name: 'Palet EUR', location: '„ი+"' },
  { sku: 'PAL-EUR-120', name: 'Palet EUR', quantity: 0, min_quantity: 5, max_quantity: 2 },
  { sku: 'PAL-EUR-120', name: 'Palet EUR', adr_class: '3' },
  { sku: 'PAL-EUR-120', name: 'Palet EUR', unit_price: -1 },
];

const TABLE = [
  ['Client', CLIENT_CASES, validateClient, normalizeClient],
  ['Driver', DRIVER_CASES, validateDriver, normalizeDriver],
  ['Invoice', INVOICE_CASES, validateInvoice, normalizeInvoice],
  ['WarehouseProduct', PRODUCT_CASES, validateWarehouseProduct, normalizeWarehouseProduct],
];

// The form and the API validate separately — the API image does not ship `src/`. A rule that
// drifts to one side turns into "the modal refuses it but curl saves it", which is how the
// whitespace-only client got in.
describe.each(TABLE)('%s parity between form and API', (entity, cases, clientValidate, clientNormalize) => {
  const server = validatorFor(entity);

  it.each(cases.map((c, i) => [i, c]))('case %i gives the same verdict', (_i, input) => {
    expect(server.validate(server.normalize(input)))
      .toEqual(clientValidate(clientNormalize(input)));
  });

  it.each(cases.map((c, i) => [i, c]))('case %i normalizes identically', (_i, input) => {
    expect(server.normalize(input)).toEqual(clientNormalize(input));
  });
});

describe('validateEntityInput', () => {
  it('covers every entity the office forms write', () => {
    expect(VALIDATED_ENTITIES).toEqual(['Client', 'Driver', 'Invoice', 'WarehouseProduct']);
  });

  it('leaves entities without rules untouched', () => {
    const body = { anything: '   ' };
    expect(validateEntityInput('Vehicle', body, { partial: false })).toEqual({ errors: null, data: body });
  });

  it('rejects a whitespace-only client name', () => {
    const { errors } = validateEntityInput('Client', { name: '   ' }, { partial: false });
    expect(errors.name).toBe('Completează denumirea clientului.');
  });

  // Accepting any EU VAT id is the point; the only thing refused is text that names nobody.
  it('takes foreign VAT ids but not prose in the CUI field', () => {
    for (const cui of ['RO12345678', 'ATU12345678', 'IE1234567FA', 'RO1', '12345678']) {
      expect(validateEntityInput('Client', { name: 'Partener', cui }, { partial: false }).errors)
        .toBeNull();
    }
    const { errors } = validateEntityInput('Client', { name: 'Partener', cui: 'nu-i CUI' }, { partial: false });
    expect(errors.cui).toMatch(/litere și cifre/);
  });

  it('trims and nulls blanks on the way in', () => {
    const { data } = validateEntityInput('Client', { name: '  Baumit  ', cui: '  ' }, { partial: false });
    expect(data.name).toBe('Baumit');
    expect(data.cui).toBeNull();
  });

  // A PUT carries only what changed. Judging the whole shape would block a status flip on a
  // driver whose phone predates these rules.
  it('judges only the fields a partial update sent', () => {
    const { errors, data } = validateEntityInput('Driver', { status: 'in_cursa' }, { partial: true });
    expect(errors).toBeNull();
    expect(data).toEqual({ status: 'in_cursa' });
  });

  it('still rejects a bad value inside a partial update', () => {
    const { errors } = validateEntityInput('Driver', { phone: '1' }, { partial: true });
    expect(errors.phone).toMatch(/Telefon invalid/);
  });

  // The normalizers fill in every field they know about; sending those back on a partial write
  // would blank columns the caller never mentioned.
  it('does not invent fields the partial update left out', () => {
    const { data } = validateEntityInput('Client', { name: 'Baumit' }, { partial: true });
    expect(Object.keys(data)).toEqual(['name']);
  });
});
