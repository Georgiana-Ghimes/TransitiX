const SERIES_MAX = 16;

export function normalizeInvoiceSeries(raw) {
  const s = String(raw || 'TRX').trim().slice(0, SERIES_MAX);
  return s || 'TRX';
}

export function formatInvoiceNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return '0001';
  return String(num).padStart(4, '0');
}

/** Next unused number for company+series. Caller must run inside a transaction. */
export async function allocateInvoiceNumber(client, companyId, series) {
  const s = normalizeInvoiceSeries(series);
  await client.query(
    `INSERT INTO invoice_counters (company_id, series, last_number)
     VALUES ($1, $2, 0)
     ON CONFLICT (company_id, series) DO NOTHING`,
    [companyId, s]
  );
  const locked = await client.query(
    `SELECT last_number FROM invoice_counters
     WHERE company_id = $1 AND series = $2
     FOR UPDATE`,
    [companyId, s]
  );
  const existing = await client.query(
    `SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::int ELSE 0 END), 0) AS n
     FROM invoices
     WHERE company_id = $1 AND series = $2`,
    [companyId, s]
  );
  const next = Math.max(Number(locked.rows[0]?.last_number) || 0, Number(existing.rows[0]?.n) || 0) + 1;
  await client.query(
    `UPDATE invoice_counters SET last_number = $3
     WHERE company_id = $1 AND series = $2`,
    [companyId, s, next]
  );
  return formatInvoiceNumber(next);
}
