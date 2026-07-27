/**
 * Local smoke test for TripDocument create + OCR update.
 * Run: node scripts/test-trip-document.js
 */
import { pool } from '../src/db.js';

async function main() {
  const client = await pool.connect();
  try {
    const trip = await client.query(
      `SELECT t.id, t.cmr_number, t.company_id
       FROM trips t
       ORDER BY t.created_at DESC
       LIMIT 1`
    );
    if (!trip.rows[0]) {
      console.error('No trips in DB — run seed-demo first');
      process.exit(1);
    }
    const { id: tripId, cmr_number, company_id } = trip.rows[0];

    const inserted = await client.query(
      `INSERT INTO trip_documents (company_id, trip_id, cmr_number, original_image_url, is_confirmed)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id`,
      [company_id, tripId, cmr_number, '/uploads/test-smoke.jpg']
    );
    const docId = inserted.rows[0].id;

    const ocr = {
      cmr_number,
      shipper: 'Test Shipper',
      _stub: true,
    };
    await client.query(
      `UPDATE trip_documents SET ocr_extracted_data = $1::jsonb WHERE id = $2`,
      [JSON.stringify(ocr), docId]
    );

    await client.query(`DELETE FROM trip_documents WHERE id = $1`, [docId]);
    console.log('OK: TripDocument create + JSONB update works');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
