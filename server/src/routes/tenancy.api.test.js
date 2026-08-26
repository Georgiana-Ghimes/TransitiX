import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { auth, closePool, dropCompany, makeAviz, makeTrip, request, seedCompany } from '../test/harness.js';

/**
 * The boundary everything else rests on.
 *
 * Every table in this system is scoped by `company_id`, and every route is expected to honour
 * it. That expectation had no test: one handler forgetting the clause would hand one customer's
 * consignment notes to another, and nothing in the suite would notice.
 */
let mine;
let theirs;
let myTrip;
let myAviz;
let theirTrip;

beforeAll(async () => {
  mine = await seedCompany('tenancy-a');
  theirs = await seedCompany('tenancy-b');
  myTrip = await makeTrip(mine.company.id, { driver_id: mine.driver.id });
  myAviz = await makeAviz(mine.company.id, { original_filename: 'al-meu.pdf' });
  theirTrip = await makeTrip(theirs.company.id, { driver_id: theirs.driver.id });
});

afterAll(async () => {
  await dropCompany(mine?.company?.id);
  await dropCompany(theirs?.company?.id);
  await closePool();
});

const api = () => request(app);

describe('reading across companies', () => {
  it('lists only my own trips', async () => {
    const res = await api().get('/api/entities/Trip').set(auth(mine.adminToken));
    expect(res.status).toBe(200);
    const ids = res.body.map((t) => t.id);
    expect(ids).toContain(myTrip.id);
    expect(ids).not.toContain(theirTrip.id);
  });

  it('404s on another company’s trip by id', async () => {
    const res = await api().get(`/api/entities/Trip/${theirTrip.id}`).set(auth(mine.adminToken));
    expect(res.status).toBe(404);
  });

  it('lists only my own avize', async () => {
    await makeAviz(theirs.company.id, { original_filename: 'al-lor.pdf' });
    const res = await api().get('/api/avize').set(auth(mine.adminToken));
    const names = res.body.map((d) => d.original_filename);
    expect(names).toContain('al-meu.pdf');
    expect(names).not.toContain('al-lor.pdf');
  });

  it('keeps the consignment note inside its company', async () => {
    expect((await api().get(`/api/cmr/trips/${theirTrip.id}`).set(auth(mine.adminToken))).status)
      .toBe(404);
  });
});

describe('writing across companies', () => {
  it('refuses to update another company’s trip', async () => {
    const res = await api().put(`/api/entities/Trip/${theirTrip.id}`)
      .set(auth(mine.adminToken)).send({ goods_description: 'schimbat de altcineva' });
    expect(res.status).toBe(404);
  });

  it('refuses to delete another company’s trip', async () => {
    const res = await api().delete(`/api/entities/Trip/${theirTrip.id}`).set(auth(mine.adminToken));
    expect(res.status).toBe(404);
  });

  it('ignores a company_id supplied in the body', async () => {
    // A client must never be able to move a row into someone else's company by asking.
    const res = await api().post('/api/entities/Trip').set(auth(mine.adminToken)).send({
      cmr_number: `TENANCY-${Date.now()}`,
      shipper_name: 'X', consignee_name: 'Y', loading_date: '2026-03-10',
      company_id: theirs.company.id,
    });
    expect(res.status).toBeLessThan(400);
    expect(res.body.company_id).toBe(mine.company.id);
  });

  it('refuses to correct another company’s document', async () => {
    const theirDoc = await makeAviz(theirs.company.id, { original_filename: 'al-lor-2.pdf' });
    const res = await api().put(`/api/documents/${theirDoc.id}/corrections`)
      .set(auth(mine.adminToken)).send({ corrections: { numar_tpo: 'furat' } });
    expect(res.status).toBe(404);
  });
});

describe('roles', () => {
  it('keeps a driver out of the office screens', async () => {
    for (const path of ['/api/reports/sources', '/api/validation/rules', '/api/avize/templates']) {
      expect((await api().get(path).set(auth(mine.driverToken))).status, path).toBe(403);
    }
  });

  it('lets a driver reach their own trip through the CMR route', async () => {
    expect((await api().get(`/api/cmr/trips/${myTrip.id}`).set(auth(mine.driverToken))).status)
      .toBe(200);
  });

  it('rejects a token signed for nothing', async () => {
    const res = await api().get('/api/entities/Trip').set({ Authorization: 'Bearer nu-e-token' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing Authorization header', async () => {
    expect((await api().get('/api/entities/Trip')).status).toBe(401);
  });
});

describe('uploads', () => {
  it('does not serve another company’s upload', async () => {
    // Upload paths carry the owning company; a guessed filename must not cross the boundary.
    const res = await api()
      .get(`/uploads/c-${theirs.company.id}-fake-file.pdf`)
      .set(auth(mine.adminToken));
    expect([403, 404]).toContain(res.status);
  });
});

describe('the document itself', () => {
  it('never leaks another company’s aviz through the report preview', async () => {
    const templates = await api().get('/api/avize/templates').set(auth(mine.adminToken));
    const res = await api().post('/api/reports/preview').set(auth(mine.adminToken))
      .send({ template_id: templates.body[0].id, filters: { status: 'confirmed' } });
    expect(res.body.documents.every((d) => d.original_filename !== 'al-lor.pdf')).toBe(true);
    expect(res.body.documents.some((d) => d.id === myAviz.id)).toBe(true);
  });
});
