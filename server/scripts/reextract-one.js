import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '../.env') });

const docId = process.argv[2] || 'a8068675-df52-4147-8d71-ea3b866ea2ed';
const { query } = await import('../src/db.js');
const { extractBatchDocuments } = await import('../src/routes/documents.js');

const row = (await query(
  'SELECT company_id, batch_id, uploaded_by, status, original_filename FROM aviz_documents WHERE id = $1',
  [docId],
)).rows[0];
if (!row) {
  console.error('not found', docId);
  process.exit(1);
}
console.log('re-extract', row);
const out = await extractBatchDocuments(row.company_id, row.batch_id, row.uploaded_by, {
  documentIds: [docId],
  force: true,
});
console.log(JSON.stringify(out, null, 2));
const after = (await query(
  'SELECT status, extraction_source, numar_tpo, needs_review FROM aviz_documents WHERE id = $1',
  [docId],
)).rows[0];
console.log('after', after);
process.exit(0);
