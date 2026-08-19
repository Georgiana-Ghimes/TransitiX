import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber, normalizeInvoiceSeries } from './invoiceNumber.js';

describe('invoice series and numbers', () => {
  it('defaults empty series to TRX', () => {
    expect(normalizeInvoiceSeries('')).toBe('TRX');
    expect(normalizeInvoiceSeries('  fac  ')).toBe('fac');
  });

  it('pads sequential numbers', () => {
    expect(formatInvoiceNumber(1)).toBe('0001');
    expect(formatInvoiceNumber(12)).toBe('0012');
    expect(formatInvoiceNumber(10000)).toBe('10000');
  });
});
