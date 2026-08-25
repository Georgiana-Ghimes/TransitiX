/**
 * e-Factura — local UBL 2.1 (CIUS-RO inspired) export.
 *
 * Does NOT talk to ANAF SPV. Generating XML is useful for manual upload /
 * future adapters; marking invoices as "sent/accepted" without a real
 * submission would be dishonest.
 */

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  const n = num(value);
  if (n == null) return '0.00';
  return n.toFixed(2);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function day(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeCui(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  return s.startsWith('RO') ? s : `RO${s}`;
}

function supplierTaxId(company = {}) {
  return normalizeCui(company.fiscal_code || company.cui);
}

/**
 * Soft validation — returns { ok, errors[] }. Missing supplier CUI is an error.
 */
export function validateInvoiceForUbl(invoice = {}, company = {}) {
  const errors = [];
  if (!invoice?.id && !invoice?.number) errors.push('Factură fără număr');
  if (!day(invoice.issue_date)) errors.push('Data emiterii lipsește');
  if (!String(invoice.client_name || '').trim()) errors.push('Clientul lipsește');
  if (!supplierTaxId(company)) errors.push('CUI-ul firmei lipsește (Setări / firmă)');
  const total = num(invoice.total_amount);
  if (total == null || total < 0) errors.push('Total invalid');
  return { ok: errors.length === 0, errors };
}

/**
 * Build a minimal UBL 2.1 Invoice XML suitable as a starting point for CIUS-RO.
 * Not a certified Schematron-valid document — labelled as local export.
 */
export function buildUblInvoice(invoice = {}, company = {}) {
  const check = validateInvoiceForUbl(invoice, company);
  if (!check.ok) {
    const err = new Error(check.errors.join('; '));
    err.status = 400;
    err.errors = check.errors;
    throw err;
  }

  const series = String(invoice.series || 'TRX').trim();
  const number = String(invoice.number || '').trim();
  const id = `${series}${number}`;
  const issueDate = day(invoice.issue_date);
  const dueDate = day(invoice.due_date);
  const currency = String(invoice.currency || 'RON').toUpperCase();
  const vatRate = num(invoice.vat_rate) ?? 19;
  const subtotal = num(invoice.subtotal) ?? 0;
  const vatAmount = num(invoice.vat_amount) ?? Math.round(subtotal * vatRate / 100 * 100) / 100;
  const total = num(invoice.total_amount) ?? (subtotal + vatAmount);
  const description = String(invoice.description || `Servicii transport ${id}`).trim();
  const supplierName = String(company.name || 'Furnizor').trim();
  const supplierCui = supplierTaxId(company);
  const supplierAddress = String(company.address || '').trim();
  const customerName = String(invoice.client_name).trim();
  const customerCui = normalizeCui(invoice.client_cui);
  const customerAddress = String(invoice.client_address || '').trim();
  const bank = String(company.bank_account || '').trim();

  const dueXml = dueDate
    ? `\n  <cbc:DueDate>${dueDate}</cbc:DueDate>`
    : '';
  const customerTax = customerCui
    ? `
        <cac:PartyTaxScheme>
          <cbc:CompanyID>${escapeXml(customerCui)}</cbc:CompanyID>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:PartyTaxScheme>`
    : '';
  const paymentMeans = bank
    ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXml(bank)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(id)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>${dueXml}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>
  <cbc:Note>Export local Transitix — nu a fost trimis către SPV ANAF</cbc:Note>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(supplierName)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(supplierAddress || '-')}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>RO</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(supplierCui)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(supplierName)}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(supplierCui)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(customerName)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(customerAddress || '-')}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>RO</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${customerTax}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(customerName)}</cbc:RegistrationName>${customerCui ? `
        <cbc:CompanyID>${escapeXml(customerCui)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>${paymentMeans}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(currency)}">${money(vatAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${money(subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(currency)}">${money(vatAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${money(vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${money(subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(currency)}">${money(subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(currency)}">${money(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(currency)}">${money(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${money(subtotal)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${money(vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(currency)}">${money(subtotal)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>
`;

  return {
    xml,
    filename: `efactura-${id}.xml`,
    id,
    stub: true,
  };
}

export function efacturaCapability() {
  // Local UBL only — never claim SPV.
  return 'ubl';
}
