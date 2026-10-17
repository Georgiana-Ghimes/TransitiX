# P5 — e-Factura UBL local (no SPV)

## What

- `server/src/lib/compliance/efactura.js` — `buildUblInvoice` / `validateInvoiceForUbl`
- `GET /api/invoices/:id/ubl` — attachment XML; does **not** update `efactura_status`
- Finance: **Descarcă UBL** / **UBL**; SPV button still honest refusal
- Health `capabilities.efactura = 'ubl'`

## Honesty rules

- Note in XML: not sent to SPV ANAF
- Missing company CUI → 400 with clear errors
- No fake `sent` / `accepted`

## Later

- Real SPV upload + status polling
- Schematron / ANAF validator round-trip
- Tachograph `.ddd` import (still open)
