import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import {
  auth,
  closePool,
  dropCompany,
  makeClient,
  makeTrip,
  makeVehicle,
  request,
  seedCompany,
} from '../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('audit');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const admin = () => auth(ctx.adminToken);

/** The trail for one record, newest first. */
async function trailFor(entity, id) {
  const res = await api().get(`/api/audit/trail/${entity}/${id}`).set(admin());
  expect(res.status).toBe(200);
  return res.body.events;
}

const countEvents = async (entity) => (await query(
  'SELECT COUNT(*)::int c FROM audit_events WHERE company_id = $1 AND entity = $2',
  [ctx.company.id, entity]
)).rows[0].c;

describe('an ordinary edit leaves a trail', () => {
  it('records a create with a readable name', async () => {
    const res = await api().post('/api/entities/Client')
      .set(admin()).send({ name: 'Baumit Audit', cui: 'RO1' });
    expect(res.status).toBe(201);

    const [event] = await trailFor('Client', res.body.id);
    expect(event.action).toBe('create');
    // A trail that reads "Client 8f3e-…" answers nothing.
    expect(event.label).toBe('Baumit Audit');
    expect(event.user.email).toBe(ctx.admin.email);
    expect(event.changes.name).toBe('Baumit Audit');
  });

  it('records only the field that moved', async () => {
    const client = await makeClient(ctx.company.id, 'Înainte');
    await api().put(`/api/entities/Client/${client.id}`)
      .set(admin()).send({ name: 'După', cui: client.cui });

    const [event] = await trailFor('Client', client.id);
    expect(event.action).toBe('update');
    expect(Object.keys(event.changes)).toEqual(['name']);
    expect(event.changes.name).toEqual({ from: 'Înainte', to: 'După' });
  });

  it('does not invent an event when nothing changed', async () => {
    // Saving a form without touching it is not an event, and a log full of them is unreadable.
    const client = await makeClient(ctx.company.id, 'Neschimbat');
    await api().put(`/api/entities/Client/${client.id}`).set(admin()).send({ name: 'Neschimbat' });
    expect(await trailFor('Client', client.id)).toHaveLength(0);
  });

  it('keeps the whole row when something is deleted', async () => {
    // A delete is the one event where nothing else will hold what was there.
    const client = await makeClient(ctx.company.id, 'De șters');
    const res = await api().delete(`/api/entities/Client/${client.id}`).set(admin());
    expect(res.status).toBe(200);

    const [event] = await trailFor('Client', client.id);
    expect(event.action).toBe('delete');
    expect(event.changes.name).toBe('De șters');
    expect(event.label).toBe('De șters');
  });

  it('survives the record it describes being gone', async () => {
    const client = await makeClient(ctx.company.id, 'Dispărut');
    await api().delete(`/api/entities/Client/${client.id}`).set(admin());
    const gone = await query('SELECT id FROM clients WHERE id = $1', [client.id]);
    expect(gone.rowCount).toBe(0);
    expect((await trailFor('Client', client.id))[0].action).toBe('delete');
  });

  it('catches a value the server derived rather than the client sent', async () => {
    // distance_source is server-owned: it is not writable, so only a row-level diff sees it.
    const trip = await makeTrip(ctx.company.id, { tpo_number: 'TPO AUDIT DIST' });
    await api().put(`/api/entities/Trip/${trip.id}`).set(admin()).send({ distance_km: 137 });

    const [event] = await trailFor('Trip', trip.id);
    expect(Object.keys(event.changes)).toContain('distance_km');
    expect(Object.keys(event.changes)).toContain('distance_source');
  });

  it('names a trip by its TPO', async () => {
    const trip = await makeTrip(ctx.company.id, { tpo_number: 'TPO 2026-0311' });
    await api().put(`/api/entities/Trip/${trip.id}`).set(admin()).send({ status: 'in_tranzit' });
    expect((await trailFor('Trip', trip.id))[0].label).toBe('TPO 2026-0311');
  });
});

describe('what the trail deliberately ignores', () => {
  it('writes nothing for a GPS ping', async () => {
    // A row per ping would bury the entries that matter and undo the retention policies.
    const vehicle = await makeVehicle(ctx.company.id, { plate: 'B 999 AUD' });
    const before = await countEvents('GPSLog');
    const res = await api().post('/api/entities/GPSLog').set(admin()).send({
      vehicle_id: vehicle.id, latitude: 45.1, longitude: 24.1, is_current: true,
    });
    expect(res.status).toBe(201);
    expect(await countEvents('GPSLog')).toBe(before);
  });

  it('writes nothing for a chat message', async () => {
    const before = await countEvents('ChatMessage');
    await api().post('/api/entities/ChatMessage')
      .set(admin()).send({ message: 'salut', sender_role: 'dispatcher' });
    expect(await countEvents('ChatMessage')).toBe(before);
  });
});

describe('secrets', () => {
  it('never writes a password hash into the trail', async () => {
    const rows = await query(
      "SELECT changes::text AS c FROM audit_events WHERE company_id = $1 AND changes IS NOT NULL",
      [ctx.company.id]
    );
    for (const row of rows.rows) {
      expect(row.c).not.toMatch(/\$2[aby]\$/);
    }
  });
});

describe('the searchable log', () => {
  it('filters by entity and by action', async () => {
    const res = await api().get('/api/audit?entity=Client&action=delete').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    for (const event of res.body.events) {
      expect(event.entity).toBe('Client');
      expect(event.action).toBe('delete');
    }
  });

  it('searches the label', async () => {
    const res = await api().get('/api/audit?q=Baumit%20Audit').set(admin());
    expect(res.body.events.every((e) => /Baumit Audit/i.test(e.label || ''))).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
  });

  it('includes the last day of a date range', async () => {
    // "to 31 March" means that day too; an exclusive bound quietly drops it.
    const today = new Date().toISOString().slice(0, 10);
    const res = await api().get(`/api/audit?from=${today}&to=${today}`).set(admin());
    expect(res.body.events.length).toBeGreaterThan(0);
  });

  it('pages, and reports the full count', async () => {
    const res = await api().get('/api/audit?limit=2').set(admin());
    expect(res.body.events).toHaveLength(2);
    expect(res.body.total).toBeGreaterThan(2);
  });

  it('returns newest first', async () => {
    const res = await api().get('/api/audit?limit=10').set(admin());
    const times = res.body.events.map((e) => new Date(e.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('says what it does not cover', async () => {
    // Somebody looking for a GPS ping should find out why it is missing, not conclude the log
    // is broken.
    const res = await api().get('/api/audit/meta').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.not_audited.GPSLog).toBeTruthy();
    expect(res.body.audited.ContractTariff).toBeTruthy();
    expect(res.body.users.some((u) => u.email === ctx.admin.email)).toBe(true);
  });
});

describe('security events', () => {
  it('records a sign-in', async () => {
    const password = 'caisele-verzi-din-livada';
    const email = `audit-login-${Date.now()}@test.local`;
    await query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, 'Audit Login', $2, $3, 'admin')`,
      [ctx.company.id, email, bcrypt.hashSync(password, 10)]
    );

    expect((await api().post('/api/auth/login').send({ email, password })).status).toBe(200);
    const events = await query(
      `SELECT action FROM audit_events WHERE company_id = $1 AND user_email = $2`,
      [ctx.company.id, email]
    );
    expect(events.rows.map((r) => r.action)).toContain('login');
  });

  it('records a failed sign-in on a real account', async () => {
    // Repeated failures against a known account are the signal worth having.
    const res = await api().post('/api/auth/login')
      .send({ email: ctx.admin.email, password: 'gresit' });
    expect(res.status).toBe(401);

    const events = await query(
      `SELECT action FROM audit_events
       WHERE company_id = $1 AND user_email = $2 AND action = 'login_failed'`,
      [ctx.company.id, ctx.admin.email]
    );
    expect(events.rowCount).toBeGreaterThan(0);
  });

  it('records nothing for an email nobody owns', async () => {
    // No company, no row: the table is scoped per company and there is nothing to scope it to.
    const before = (await query('SELECT COUNT(*)::int c FROM audit_events')).rows[0].c;
    await api().post('/api/auth/login').send({ email: 'nimeni@nicaieri.ro', password: 'x' });
    expect((await query('SELECT COUNT(*)::int c FROM audit_events')).rows[0].c).toBe(before);
  });
});

describe('the depot', () => {
  it('records the move, by name', async () => {
    // Moving the garage silently changes every billable kilometre computed afterwards.
    const location = (await query(
      `INSERT INTO locations (company_id, name, latitude, longitude)
       VALUES ($1, 'Garaj Nou', 45.5, 24.5) RETURNING *`,
      [ctx.company.id]
    )).rows[0];

    const res = await api().put('/api/commercial/depot')
      .set(admin()).send({ location_id: location.id });
    expect(res.status).toBe(200);

    const [event] = await trailFor('Depot', location.id);
    expect(event.action).toBe('update');
    expect(event.label).toBe('Garaj Nou');
    expect(event.changes.default_depot_location_id.to).toBe('Garaj Nou');
  });
});

describe('who may read it', () => {
  it('refuses a driver outright', async () => {
    expect((await api().get('/api/audit').set(auth(ctx.driverToken))).status).toBe(403);
    expect((await api().get('/api/audit/trail/Client/' + ctx.company.id)
      .set(auth(ctx.driverToken))).status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await api().get('/api/audit')).status).toBe(401);
  });
});

describe('tenancy', () => {
  it('never shows another company’s history', async () => {
    const other = await seedCompany('audit-other');
    try {
      const theirs = await makeClient(other.company.id, 'Al lor');
      await api().put(`/api/entities/Client/${theirs.id}`)
        .set(auth(other.adminToken)).send({ name: 'Al lor, schimbat' });

      // Their own admin sees it.
      const mine = await api().get(`/api/audit/trail/Client/${theirs.id}`)
        .set(auth(other.adminToken));
      expect(mine.body.events.length).toBeGreaterThan(0);

      // Ours does not.
      const stolen = await api().get(`/api/audit/trail/Client/${theirs.id}`).set(admin());
      expect(stolen.body.events).toHaveLength(0);

      const listed = await api().get('/api/audit?limit=200').set(admin());
      expect(listed.body.events.some((e) => e.label === 'Al lor, schimbat')).toBe(false);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});
