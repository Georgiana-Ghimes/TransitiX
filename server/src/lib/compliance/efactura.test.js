import { describe, expect, it } from 'vitest';
import { buildUblInvoice, efacturaCapability, validateInvoiceForUbl } from './efactura.js';

const company = {
  name: 'Transitix SRL',
  fiscal_code: '12345678',
  address: 'Str. Test 1, Timișoara',
  bank_account: 'RO49AAAA1B31007593840000',
};

const invoice = {
  id: 'inv-1',
  series: 'TRX',
  number: '0001',
  issue_date: '2026-08-25',
  due_date: '2026-09-25',
  client_name: 'Client SA',
  client_cui: 'RO99887766',
  client_address: 'Bd. Unirii 10',
  description: 'Transport CMR-1',
  subtotal: 1000,
  vat_rate: 19,
  vat_amount: 190,
  total_amount: 1190,
  currency: 'RON',
};

describe('efactura UBL', () => {
  it('reports local ubl capability only', () => {
    expect(efacturaCapability()).toBe('ubl');
  });

  it('rejects missing supplier CUI', () => {
    const v = validateInvoiceForUbl(invoice, { name: 'X' });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /CUI/i.test(e))).toBe(true);
  });

  it('builds escaped UBL with CIUS-RO customization and honest note', () => {
    const { xml, filename, id, stub } = buildUblInvoice(
      { ...invoice, description: 'Marfă <ADR> & "test"' },
      company
    );
    expect(stub).toBe(true);
    expect(id).toBe('TRX0001');
    expect(filename).toBe('efactura-TRX0001.xml');
    expect(xml).toContain('CustomizationID');
    expect(xml).toContain('CIUS-RO');
    expect(xml).toContain('nu a fost trimis către SPV ANAF');
    expect(xml).toContain('RO12345678');
    expect(xml).toContain('RO99887766');
    expect(xml).toContain('1190.00');
    expect(xml).toContain('Marfă &lt;ADR&gt; &amp; &quot;test&quot;');
    expect(xml).not.toContain('<ADR>');
  });

  it('normalizes CUI without RO prefix', () => {
    const { xml } = buildUblInvoice(invoice, { ...company, fiscal_code: '555' });
    expect(xml).toContain('>RO555<');
  });
});
