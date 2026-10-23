import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { signAccessToken } from '../middleware/auth.js';
import { ensurePlatformCompany } from '../lib/platform/company.js';
import { addressMatchKey, listKnownAddresses, recordAddressSighting } from '../lib/ocr/addressMemory.js';
import { auth, closePool, dropCompany, makeAviz, request, seedCompany } from '../test/harness.js';

/**
 * GOD „Date învățate”: a misread learned from one aviz (Kepublicii) is corrected into the
 * address that already exists (Republicii). The edit must offer a merge, the merge must not
 * double-count a document, and the same misread must never come back as a new candidate.
 */
const REAL = 'Str. Republicii nr. 1F, Bolintin-Deal';
const MISREAD = 'Str. Kepublicii nr. 1F, Bolintin-Deal';
const POSTCODE = '087015';

let tenant;
let other;
let godUser;
let godToken;
let docs;
let real;
let misread;

async function insertAddress(companyId, display, seenDocs) {
  const street = (display.match(/Str\.\s+(\S+)/)?.[1] || 'x').toLowerCase();
  const row = (await query(
    `INSERT INTO aviz_known_addresses (company_id, role, postcode, locality, street_name, display,
       match_key, source, seen_count, used_count, last_seen_at)
     VALUES ($1, 'origin', $2, 'Bolintin-Deal', $3, $4, $5, 'parsed', $6, 1, NOW())
     RETURNING *`,
    [companyId, POSTCODE, street, display, addressMatchKey(display), seenDocs.length],
  )).rows[0];
  for (const doc of seenDocs) {
    await query(
      `INSERT INTO aviz_known_address_sightings (address_id, document_id) VALUES ($1, $2)`,
      [row.id, doc.id],
    );
  }
  return row;
}

beforeAll(async () => {
  tenant = await seedCompany('learned-merge');
  other = await seedCompany('learned-other');
  const platform = await ensurePlatformCompany(query);
  godUser = (await query(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, 'GOD test', $2, 'x', 'platform_admin') RETURNING *`,
    [platform.id, `god-${Date.now()}@test.local`],
  )).rows[0];
  godToken = signAccessToken(godUser);

  docs = [];
  for (const name of ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']) {
    docs.push(await makeAviz(tenant.company.id, { original_filename: name }));
  }
  // Real address seen on A and B; the misread on B (same document, other page) and C.
  real = await insertAddress(tenant.company.id, REAL, [docs[0], docs[1]]);
  misread = await insertAddress(tenant.company.id, MISREAD, [docs[1], docs[2]]);
});

afterAll(async () => {
  await dropCompany(tenant?.company?.id);
  await dropCompany(other?.company?.id);
  if (godUser) await query('DELETE FROM users WHERE id = $1', [godUser.id]);
  await closePool();
});

const api = () => request(app);

describe('correcting a misread into an existing address', () => {
  it('answers the edit with the existing address instead of a bare conflict', async () => {
    const res = await api()
      .patch(`/api/platform/learned-addresses/${misread.id}`)
      .set(auth(godToken))
      .send({ display: REAL });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ADDRESS_EXISTS');
    expect(res.body.existing.id).toBe(real.id);
    expect(res.body.existing.display).toBe(REAL);
  });

  it('merges without counting a shared document twice', async () => {
    const res = await api()
      .post(`/api/platform/learned-addresses/${misread.id}/merge`)
      .set(auth(godToken))
      .send({ into: real.id });
    expect(res.status).toBe(200);
    expect(res.body.merged_id).toBe(misread.id);
    // A, B, C — B showed both forms and counts once.
    expect(res.body.address.seen_count).toBe(3);
    expect(res.body.address.used_count).toBe(2);
    expect(res.body.address.verified).toBe(true);
    expect(res.body.address.display).toBe(REAL);
    expect(res.body.address.merged_variants.map((v) => v.display)).toEqual([MISREAD]);

    const sightings = await query(
      `SELECT document_id FROM aviz_known_address_sightings WHERE address_id = $1`,
      [real.id],
    );
    expect(sightings.rows.map((r) => r.document_id).sort())
      .toEqual([docs[0].id, docs[1].id, docs[2].id].sort());

    const alias = (await query('SELECT * FROM aviz_known_addresses WHERE id = $1', [misread.id])).rows[0];
    expect(alias.merged_into).toBe(real.id);
    expect(alias.disabled).toBe(true);

    const audit = await query(
      `SELECT action, entity, detail FROM audit_events WHERE company_id = $1 AND entity_id = $2`,
      [tenant.company.id, real.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe('merge');
    expect(audit.rows[0].detail.merged.id).toBe(misread.id);
    expect(audit.rows[0].detail.duplicates).toBe(1);
  });

  it('leaves the misread out of the list', async () => {
    const res = await api()
      .get(`/api/platform/learned-addresses?company_id=${tenant.company.id}`)
      .set(auth(godToken));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.id)).toEqual([real.id]);
  });

  it('counts the same misread on a later aviz toward the real address', async () => {
    const row = await recordAddressSighting(query, {
      companyId: tenant.company.id,
      documentId: docs[3].id,
      observation: {
        postcode: POSTCODE,
        locality: 'Bolintin-Deal',
        street_name: 'kepublicii',
        display: MISREAD,
        match_key: addressMatchKey(MISREAD),
      },
    });
    expect(row.id).toBe(real.id);
    expect(row.seen_count).toBe(4);
    const live = await query(
      `SELECT id FROM aviz_known_addresses
       WHERE company_id = $1 AND merged_into IS NULL AND disabled = FALSE`,
      [tenant.company.id],
    );
    expect(live.rows.map((r) => r.id)).toEqual([real.id]);
  });

  it('refuses to merge twice or across companies', async () => {
    const again = await api()
      .post(`/api/platform/learned-addresses/${misread.id}/merge`)
      .set(auth(godToken))
      .send({ into: real.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_merged');

    const foreign = await insertAddress(other.company.id, 'Str. Altceva nr. 2, Bolintin-Deal', []);
    const cross = await api()
      .post(`/api/platform/learned-addresses/${foreign.id}/merge`)
      .set(auth(godToken))
      .send({ into: real.id });
    expect(cross.status).toBe(409);
    expect(cross.body.code).toBe('other_company');
  });

  it('refuses an edit on a merged variant', async () => {
    const res = await api()
      .patch(`/api/platform/learned-addresses/${misread.id}`)
      .set(auth(godToken))
      .send({ display: 'Str. Republicii nr. 3, Bolintin-Deal' });
    expect(res.status).toBe(409);
  });

  it('refuses bad ids, a self-merge and a merge into a variant', async () => {
    const bad = await api()
      .post('/api/platform/learned-addresses/not-a-uuid/merge')
      .set(auth(godToken))
      .send({ into: real.id });
    expect(bad.status).toBe(400);

    const self = await api()
      .post(`/api/platform/learned-addresses/${real.id}/merge`)
      .set(auth(godToken))
      .send({ into: real.id });
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('same');

    const stray = await insertAddress(tenant.company.id, 'Str. Repuhlicii nr. 1F, Bolintin-Deal', []);
    const intoVariant = await api()
      .post(`/api/platform/learned-addresses/${stray.id}/merge`)
      .set(auth(godToken))
      .send({ into: misread.id });
    expect(intoVariant.status).toBe(409);
    expect(intoVariant.body.code).toBe('target_merged');
    await query('DELETE FROM aviz_known_addresses WHERE id = $1', [stray.id]);
  });

  it('refuses a merge into a disabled address', async () => {
    const off = await insertAddress(tenant.company.id, 'Str. Oprita nr. 9, Bolintin-Deal', []);
    const stray = await insertAddress(tenant.company.id, 'Str. 0prita nr. 9, Bolintin-Deal', []);
    await query('UPDATE aviz_known_addresses SET disabled = TRUE WHERE id = $1', [off.id]);
    const res = await api()
      .post(`/api/platform/learned-addresses/${stray.id}/merge`)
      .set(auth(godToken))
      .send({ into: off.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('target_disabled');
    const untouched = (await query('SELECT merged_into FROM aviz_known_addresses WHERE id = $1', [stray.id])).rows[0];
    expect(untouched.merged_into).toBeNull();
    await query('DELETE FROM aviz_known_addresses WHERE id = ANY($1::uuid[])', [[off.id, stray.id]]);
  });

  it('is GOD-only', async () => {
    const res = await api()
      .post(`/api/platform/learned-addresses/${misread.id}/merge`)
      .set(auth(tenant.adminToken))
      .send({ into: real.id });
    expect(res.status).toBe(403);
  });
});

describe('merging a variant that already has variants of its own', () => {
  const TOP = 'Str. Gării nr. 5, Bolintin-Deal';
  const MID = 'Str. Gorii nr. 5, Bolintin-Deal';
  const LEAF = 'Str. Carii nr. 5, Bolintin-Deal';
  let top;
  let mid;
  let leaf;
  let chainDocs;

  beforeAll(async () => {
    chainDocs = [];
    for (const name of ['g1.pdf', 'g2.pdf', 'g3.pdf', 'g4.pdf']) {
      chainDocs.push(await makeAviz(tenant.company.id, { original_filename: name }));
    }
    top = await insertAddress(tenant.company.id, TOP, [chainDocs[0]]);
    mid = await insertAddress(tenant.company.id, MID, [chainDocs[1]]);
    leaf = await insertAddress(tenant.company.id, LEAF, [chainDocs[2]]);
  });

  it('re-points the older variant straight at the real address', async () => {
    const first = await api()
      .post(`/api/platform/learned-addresses/${leaf.id}/merge`)
      .set(auth(godToken))
      .send({ into: mid.id });
    expect(first.status).toBe(200);

    const second = await api()
      .post(`/api/platform/learned-addresses/${mid.id}/merge`)
      .set(auth(godToken))
      .send({ into: top.id });
    expect(second.status).toBe(200);
    // g1 + g2 + g3, each once.
    expect(second.body.address.seen_count).toBe(3);
    expect(second.body.address.merged_variants.map((v) => v.display).sort()).toEqual([LEAF, MID].sort());

    const rows = (await query(
      'SELECT id, merged_into FROM aviz_known_addresses WHERE id = ANY($1::uuid[])',
      [[mid.id, leaf.id]],
    )).rows;
    for (const row of rows) expect(row.merged_into).toBe(top.id);

    const sightings = await query(
      'SELECT count(*)::int AS n FROM aviz_known_address_sightings WHERE address_id = ANY($1::uuid[])',
      [[mid.id, leaf.id]],
    );
    expect(sightings.rows[0].n).toBe(0);
  });

  it('counts the oldest misread on a new aviz toward the real address', async () => {
    const row = await recordAddressSighting(query, {
      companyId: tenant.company.id,
      documentId: chainDocs[3].id,
      observation: {
        postcode: POSTCODE,
        locality: 'Bolintin-Deal',
        street_name: 'carii',
        display: LEAF,
        match_key: addressMatchKey(LEAF),
      },
    });
    expect(row.id).toBe(top.id);
    expect(row.seen_count).toBe(4);

    // The same document again is not a new sighting.
    const again = await recordAddressSighting(query, {
      companyId: tenant.company.id,
      documentId: chainDocs[3].id,
      observation: {
        postcode: POSTCODE,
        locality: 'Bolintin-Deal',
        street_name: 'carii',
        display: LEAF,
        match_key: addressMatchKey(LEAF),
      },
    });
    expect(again.seen_count).toBe(4);
  });
});

describe('delivery addresses', () => {
  const GIULESTI = 'Calea Giulesti nr. 1-3, Bucuresti';
  let deliveryDocs;

  beforeAll(async () => {
    deliveryDocs = [];
    for (const name of ['l1.pdf', 'l2.pdf']) {
      deliveryDocs.push(await makeAviz(tenant.company.id, { original_filename: name }));
    }
  });

  const sighting = (doc) => recordAddressSighting(query, {
    companyId: tenant.company.id,
    documentId: doc.id,
    role: 'delivery',
    observation: {
      postcode: '060251',
      locality: 'Bucuresti',
      street_name: 'giulesti',
      display: GIULESTI,
      match_key: addressMatchKey(GIULESTI),
    },
  });

  it('keeps a delivery site apart from the depots and trusts it after two avize', async () => {
    const first = await sighting(deliveryDocs[0]);
    expect(first.role).toBe('delivery');
    expect(first.seen_count).toBe(1);
    const second = await sighting(deliveryDocs[1]);
    expect(second.id).toBe(first.id);
    expect(second.seen_count).toBe(2);

    const all = await listKnownAddresses(query, tenant.company.id, { role: null });
    expect(all.some((a) => a.id === first.id)).toBe(true);
    const origins = await listKnownAddresses(query, tenant.company.id);
    expect(origins.some((a) => a.id === first.id)).toBe(false);
  });

  it('filters the list by role', async () => {
    const delivery = await api()
      .get(`/api/platform/learned-addresses?company_id=${tenant.company.id}&role=delivery`)
      .set(auth(godToken));
    expect(delivery.status).toBe(200);
    expect(delivery.body.items.map((i) => i.display)).toEqual([GIULESTI]);
    expect(delivery.body.items[0].trust).toBe('trusted');

    const origin = await api()
      .get(`/api/platform/learned-addresses?company_id=${tenant.company.id}&role=origin`)
      .set(auth(godToken));
    expect(origin.body.items.every((i) => i.role === 'origin')).toBe(true);

    const bad = await api()
      .get('/api/platform/learned-addresses?role=client')
      .set(auth(godToken));
    expect(bad.status).toBe(400);
  });

  it('adds a delivery site by hand', async () => {
    const res = await api()
      .post('/api/platform/learned-addresses')
      .set(auth(godToken))
      .send({
        company_id: tenant.company.id,
        role: 'delivery',
        postcode: '021901',
        display: 'Bvd. Pierre De Coubertin nr. 3-5, Bucuresti',
      });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('delivery');
    expect(res.body.trust).toBe('trusted');
    expect(res.body.street_name).toBe('pierre de coubertin');
  });

  it('will not merge a delivery site into a depot', async () => {
    const site = (await query(
      `SELECT id FROM aviz_known_addresses WHERE company_id = $1 AND role = 'delivery' AND postcode = '060251'`,
      [tenant.company.id],
    )).rows[0];
    const res = await api()
      .post(`/api/platform/learned-addresses/${site.id}/merge`)
      .set(auth(godToken))
      .send({ into: real.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('other_role');
  });
});
