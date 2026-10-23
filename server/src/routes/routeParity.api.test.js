import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { addressMatchKey } from '../lib/ocr/addressMemory.js';
import {
  auth,
  closePool,
  dropCompany,
  makeAviz,
  makeTemplate,
  request,
  seedCompany,
} from '../test/harness.js';

/**
 * One aviz, one route: the /avize list and a /reports sheet over the same document must agree,
 * also when the route came from the company's address memory (#112), which /reports used to skip.
 */

// Expeditor street lost to the scanner, postcode and town intact.
const GARBLED_ORIGIN = [
  'Expeditor',
  'Site:\tBolintin',
  'Str.-.epuolicii, nr. IF Bolintin-Deal RO 087015 ROU',
  'Aviz de expeditie: PSL-0061424',
  'Adresa de livrare\tClient',
  'GIULESTI BUILD SRL\tC23900001 GIULESTI BUILD SRL',
  'Calea Giulesti, nr. 1-3\tCalea Giulesti, nr. 1-3',
  'Bucuresti Sector 6 RO 060251\tBucuresti Sector 6 RO 060251',
  'Client factura:\tGIULESTI BUILD SRL',
  'Comanda de transport TPO-0035317',
].join('\n');

const MEMORY_ROUTE = 'Str. Republicii nr. 1F, Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti';

let ctx;
let template;
let memoryDoc;
let plainDoc;

beforeAll(async () => {
  ctx = await seedCompany('route-parity');
  const companyId = ctx.company.id;
  template = await makeTemplate(companyId, `Ruta ${Date.now()}`, [
    { key: 'ruta', header: 'Ruta', source: 'ruta_transport' },
  ]);
  const display = 'Str. Republicii nr. 1F, Bolintin-Deal';
  await query(
    `INSERT INTO aviz_known_addresses (company_id, role, postcode, locality, street_name, display,
       match_key, source, seen_count, last_seen_at)
     VALUES ($1, 'origin', '087015', 'Bolintin-Deal', 'republicii', $2, $3, 'parsed', 3, NOW())`,
    [companyId, display, addressMatchKey(display)],
  );
  memoryDoc = await makeAviz(companyId, {
    status: 'extracted', ruta_transport: 'Bolintin-Deal / Calea Giulesti nr. 1-3, Bucuresti',
  });
  plainDoc = await makeAviz(companyId, { status: 'extracted', ruta_transport: 'Chiajna / Bucuresti' });
  await query(
    `UPDATE aviz_documents SET ocr_profile_id = 'aviz_baumit', extracted_data = $2::jsonb WHERE id = $1`,
    [memoryDoc.id, JSON.stringify({ raw_text: GARBLED_ORIGIN, values: {} })],
  );
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

async function listRoute(id) {
  const res = await request(app).get('/api/avize').query({ limit: 100 }).set(auth(ctx.adminToken));
  expect(res.status).toBe(200);
  const rows = Array.isArray(res.body) ? res.body : (res.body.rows || res.body.items || res.body.avize || res.body.data);
  return rows.find((r) => r.id === id);
}

async function reportRoute(id) {
  const res = await request(app).post('/api/reports/preview').set(auth(ctx.adminToken))
    .send({ template_id: template.id, filters: { aviz_ids: [id] } });
  expect(res.status).toBe(200);
  expect(res.body.rows).toHaveLength(1);
  return res.body.rows[0].ruta;
}

describe('/avize and /reports over the same aviz', () => {
  it('show the address-memory route in both', async () => {
    const listed = await listRoute(memoryDoc.id);
    expect(listed.ruta_transport).toBe(MEMORY_ROUTE);
    expect(listed.extracted_data.route_trace_view).toMatchObject({ context: 'decorate', source: 'memory' });
    expect(await reportRoute(memoryDoc.id)).toBe(listed.ruta_transport);
  });

  it('agree on a row with nothing learned', async () => {
    const listed = await listRoute(plainDoc.id);
    expect(await reportRoute(plainDoc.id)).toBe(listed.ruta_transport);
  });
});
