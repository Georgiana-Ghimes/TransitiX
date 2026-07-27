/**
 * API smoke test — no secrets printed.
 * Run: node scripts/test-api-flow.js
 */
const API = 'http://localhost:3001/api';

async function json(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(data?.message || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  const login = await json('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sofer@transitix.ro', password: 'sofer123' }),
  });
  const headers = {
    Authorization: `Bearer ${login.access_token}`,
    'Content-Type': 'application/json',
  };

  const trips = await json('/entities/Trip/filter', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filters: {} }),
  });
  if (!trips.length) throw new Error('No trips for test user company');
  const trip = trips[0];

  const doc = await json('/entities/TripDocument', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trip_id: trip.id,
      cmr_number: trip.cmr_number,
      original_image_url: '/uploads/smoke-test.jpg',
      is_confirmed: false,
    }),
  });

  const ocr = await json('/integrations/llm', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trip_id: trip.id,
      trip_context: trip,
      response_json_schema: { type: 'object', properties: { cmr_number: { type: 'string' } } },
    }),
  });

  await json(`/entities/TripDocument/${doc.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ocr_extracted_data: ocr }),
  });

  const link = await json(`/trips/${trip.id}/confirmation-link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ origin: 'http://localhost:5173' }),
  });
  if (!link.link?.includes('/confirm/')) throw new Error('Invalid confirmation link');

  await json(`/entities/TripDocument/${doc.id}`, { method: 'DELETE', headers });

  console.log('OK: login, TripDocument, OCR, confirmation-link');
}

main().catch((err) => {
  console.error(`FAIL (${err.status || 'err'}):`, err.message);
  process.exit(1);
});
