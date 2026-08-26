/**
 * One recorder for every export, whichever screen produced it.
 *
 * There were two export paths for a while, and only the newer one stored the rendered rows. That
 * meant an export made from the older screen could never be re-downloaded — and nobody would find
 * out until a customer asked for the March file again. Both paths now come through here, so the
 * history is uniform regardless of where the button was.
 */
import { query } from '../../db.js';

export async function recordExport({
  companyId,
  userId,
  templateId = null,
  templateName = null,
  documents = [],
  filename,
  columns = [],
  rows = [],
  totals = null,
  warnings = [],
  filters = null,
  batchId = null,
  note = null,
  kind = 'xlsx',
}) {
  await query(
    `INSERT INTO aviz_export_log
       (company_id, user_id, kind, template_id, template_name, aviz_ids, filename,
        row_count, filters, totals, warnings, snapshot, batch_id, note)
     VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,
    [
      companyId,
      userId ?? null,
      kind,
      templateId,
      templateName,
      documents.map((doc) => (typeof doc === 'string' ? doc : doc.id)),
      filename ?? null,
      rows.length,
      filters == null ? null : JSON.stringify(filters),
      JSON.stringify(totals ?? {}),
      JSON.stringify(warnings ?? []),
      JSON.stringify({ columns, rows, totals: totals ?? null }),
      batchId,
      note ? String(note).slice(0, 400) : null,
    ]
  );
}
