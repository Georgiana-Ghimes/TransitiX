import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../app.js';
import { query } from '../db.js';
import { auth, closePool, dropCompany, request, seedCompany } from '../test/harness.js';

let ctx;

beforeAll(async () => {
  ctx = await seedCompany('users');
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const admin = () => auth(ctx.adminToken);
let seq = 0;
const freshEmail = () => `invitat-${Date.now()}-${(seq += 1)}@test.local`;

const invite = (body) => api().post('/api/users/invite').set(admin()).send(body);

/** A second admin, so the last-admin rules can be exercised from both sides. */
async function extraAdmin() {
  const email = freshEmail();
  const res = await invite({ name: 'Al Doilea Admin', email, role: 'admin' });
  expect(res.status).toBe(201);
  return res.body.user;
}

describe('inviting somebody', () => {
  it('creates the account and hands back a link nobody else has', async () => {
    const email = freshEmail();
    const res = await invite({ name: 'Ana Pop', email, role: 'dispatcher' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.state).toBe('invited');
    // No mail provider in tests, so the link comes back rather than being quietly swallowed.
    expect(res.body.email_sent).toBe(false);
    expect(res.body.invite_link).toContain('/reset-password?token=');
  });

  it('never lets an admin choose somebody else’s password', async () => {
    // The stored hash is seeded from random bytes; the invitation link is the only way in.
    const email = freshEmail();
    await invite({ name: 'Fără Parolă', email, role: 'finance' });

    const login = await api().post('/api/auth/login').send({ email, password: 'invite' });
    expect(login.status).toBe(401);
    // An empty password is refused at validation (400) rather than at authentication; the claim
    // here is only that nothing gets in.
    for (const guess of ['', 'password', '123456', email, 'Transitix']) {
      const res = await api().post('/api/auth/login').send({ email, password: guess });
      expect(res.status, guess).not.toBe(200);
    }
  });

  it('lets the invited person set their own password and sign in', async () => {
    const email = freshEmail();
    const { body } = await invite({ name: 'Se Autentifică', email, role: 'dispatcher' });
    const token = new URL(body.invite_link).searchParams.get('token');

    const set = await api().post('/api/auth/reset-password')
      .send({ resetToken: token, newPassword: 'parola-mea-123' });
    expect(set.status).toBe(200);

    const login = await api().post('/api/auth/login').send({ email, password: 'parola-mea-123' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('dispatcher');
  });

  it('lowercases the address so one person is one account', async () => {
    const email = freshEmail();
    expect((await invite({ name: 'Unu', email: email.toUpperCase(), role: 'finance' })).status)
      .toBe(201);
    const again = await invite({ name: 'Doi', email, role: 'finance' });
    expect(again.status).toBe(409);
  });

  it('points at reactivation rather than a second account', async () => {
    const email = freshEmail();
    const { body } = await invite({ name: 'Dezactivat', email, role: 'finance' });
    await api().put(`/api/users/${body.user.id}/active`).set(admin()).send({ is_active: false });

    const again = await invite({ name: 'Dezactivat', email, role: 'finance' });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Reactivează/);
  });

  it('refuses an address that could never receive the link', async () => {
    expect((await invite({ name: 'Ana', email: 'nu-e-email', role: 'admin' })).status).toBe(400);
  });

  it('refuses a role the database would not accept', async () => {
    expect((await invite({ name: 'Ana', email: freshEmail(), role: 'owner' })).status).toBe(400);
  });

  it('links a driver profile that already carries the address', async () => {
    // Otherwise the account signs in to an empty driver app: trips resolve via drivers.user_id.
    const email = freshEmail();
    const driver = (await query(
      `INSERT INTO drivers (company_id, name, email, phone, is_active)
       VALUES ($1, 'Sofer Fara Cont', $2, '0700000001', TRUE) RETURNING id`,
      [ctx.company.id, email]
    )).rows[0];

    const res = await invite({ name: 'Sofer Fara Cont', email, role: 'driver' });
    expect(res.body.user.driver_id).toBe(driver.id);
    expect(res.body.user.driver_ready).toBe(true);
  });

  it('flags a driver account with no profile behind it', async () => {
    const res = await invite({ name: 'Sofer Nelegat', email: freshEmail(), role: 'driver' });
    expect(res.body.user.driver_ready).toBe(false);
  });
});

describe('the list', () => {
  it('never returns a password hash, a reset token or a 2FA secret', async () => {
    const res = await api().get('/api/users').set(admin());
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/password_hash|reset_token|two_factor_secret|\$2[aby]\$/);
  });

  it('describes the roles it offers', async () => {
    const res = await api().get('/api/users').set(admin());
    expect(res.body.roles.dispatcher.label).toBe('Dispecer');
    expect(res.body.admin_count).toBeGreaterThanOrEqual(1);
  });

  it('offers the driver profiles nobody is signed in as', async () => {
    await query(
      `INSERT INTO drivers (company_id, name, phone, is_active)
       VALUES ($1, 'Liber De Legat', '0700000002', TRUE)`,
      [ctx.company.id]
    );
    const res = await api().get('/api/users').set(admin());
    expect(res.body.unlinked_drivers.some((d) => d.name === 'Liber De Legat')).toBe(true);
  });
});

describe('changing a role', () => {
  it('promotes and demotes an ordinary account', async () => {
    const { body } = await invite({ name: 'Promovat', email: freshEmail(), role: 'finance' });
    const res = await api().put(`/api/users/${body.user.id}/role`)
      .set(admin()).send({ role: 'dispatcher' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('dispatcher');
  });

  it('ends their sessions, because the token still says the old role', async () => {
    const email = freshEmail();
    const { body } = await invite({ name: 'Cu Sesiune', email, role: 'finance' });
    const token = new URL(body.invite_link).searchParams.get('token');
    await api().post('/api/auth/reset-password').send({ resetToken: token, newPassword: 'parola-123' });
    await api().post('/api/auth/login').send({ email, password: 'parola-123' });

    const res = await api().put(`/api/users/${body.user.id}/role`)
      .set(admin()).send({ role: 'dispatcher' });
    expect(res.body.sessions_revoked).toBeGreaterThan(0);
  });

  it('refuses to change your own role', async () => {
    const res = await api().put(`/api/users/${ctx.admin.id}/role`)
      .set(admin()).send({ role: 'dispatcher' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/propriul rol/);
  });

  it('refuses to strip the last admin', async () => {
    // The company would lose user administration, tariffs and the audit trail at once, and the
    // only way back would be SQL.
    const other = await seedCompany('users-solo');
    try {
      const res = await request(app).put(`/api/users/${other.admin.id}/role`)
        .set(auth(other.adminToken)).send({ role: 'dispatcher' });
      // Blocked by the self rule first; the last-admin rule is what catches a second admin.
      expect(res.status).toBe(422);

      const second = await request(app).post('/api/users/invite')
        .set(auth(other.adminToken))
        .send({ name: 'Al Doilea', email: `solo-${Date.now()}@test.local`, role: 'admin' });
      const demoteThem = await request(app).put(`/api/users/${second.body.user.id}/role`)
        .set(auth(other.adminToken)).send({ role: 'driver' });
      // Two admins now, so demoting one is fine.
      expect(demoteThem.status).toBe(200);
    } finally {
      await dropCompany(other.company.id);
    }
  });

  it('refuses an unknown role and a no-op', async () => {
    const target = await extraAdmin();
    expect((await api().put(`/api/users/${target.id}/role`).set(admin()).send({ role: 'owner' }))
      .status).toBe(422);
    expect((await api().put(`/api/users/${target.id}/role`).set(admin()).send({ role: 'admin' }))
      .status).toBe(422);
  });
});

describe('deactivating', () => {
  it('turns the account off and ends every session', async () => {
    const email = freshEmail();
    const { body } = await invite({ name: 'De Oprit', email, role: 'dispatcher' });
    const token = new URL(body.invite_link).searchParams.get('token');
    await api().post('/api/auth/reset-password').send({ resetToken: token, newPassword: 'parola-123' });
    const session = await api().post('/api/auth/login').send({ email, password: 'parola-123' });

    const res = await api().put(`/api/users/${body.user.id}/active`)
      .set(admin()).send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
    expect(res.body.sessions_revoked).toBeGreaterThan(0);
    // Says plainly how long an already-issued access token survives, rather than implying the
    // cut is instant.
    expect(res.body.access_token_ttl).toBeTruthy();

    // They can no longer renew, and they can no longer sign in.
    const refresh = await api().post('/api/auth/refresh')
      .send({ refresh_token: session.body.refresh_token });
    expect(refresh.status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email, password: 'parola-123' })).status)
      .toBe(401);
  });

  it('keeps the account rather than deleting it', async () => {
    // users.id is on the audit trail; deleting the row would blank who did what.
    const { body } = await invite({ name: 'Rămâne', email: freshEmail(), role: 'finance' });
    await api().put(`/api/users/${body.user.id}/active`).set(admin()).send({ is_active: false });
    const row = await query('SELECT is_active FROM users WHERE id = $1', [body.user.id]);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].is_active).toBe(false);
  });

  it('turns it back on', async () => {
    const { body } = await invite({ name: 'Revine', email: freshEmail(), role: 'finance' });
    await api().put(`/api/users/${body.user.id}/active`).set(admin()).send({ is_active: false });
    const res = await api().put(`/api/users/${body.user.id}/active`)
      .set(admin()).send({ is_active: true });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(true);
  });

  it('refuses to deactivate you', async () => {
    const res = await api().put(`/api/users/${ctx.admin.id}/active`)
      .set(admin()).send({ is_active: false });
    expect(res.status).toBe(422);
  });
});

describe('the driver profile link', () => {
  it('links and unlinks', async () => {
    const { body } = await invite({ name: 'Sofer De Legat', email: freshEmail(), role: 'driver' });
    const driver = (await query(
      `INSERT INTO drivers (company_id, name, phone, is_active)
       VALUES ($1, 'Profil Liber', '0700000003', TRUE) RETURNING id`,
      [ctx.company.id]
    )).rows[0];

    const linked = await api().put(`/api/users/${body.user.id}/driver`)
      .set(admin()).send({ driver_id: driver.id });
    expect(linked.body.driver_id).toBe(driver.id);
    expect(linked.body.driver_ready).toBe(true);

    const cleared = await api().put(`/api/users/${body.user.id}/driver`)
      .set(admin()).send({ driver_id: null });
    expect(cleared.body.driver_id).toBeNull();
  });

  it('never lets two accounts claim one profile', async () => {
    const a = await invite({ name: 'Sofer A', email: freshEmail(), role: 'driver' });
    const b = await invite({ name: 'Sofer B', email: freshEmail(), role: 'driver' });
    const driver = (await query(
      `INSERT INTO drivers (company_id, name, phone, is_active)
       VALUES ($1, 'Disputat', '0700000004', TRUE) RETURNING id`,
      [ctx.company.id]
    )).rows[0];

    await api().put(`/api/users/${a.body.user.id}/driver`).set(admin()).send({ driver_id: driver.id });
    const stolen = await api().put(`/api/users/${b.body.user.id}/driver`)
      .set(admin()).send({ driver_id: driver.id });
    expect(stolen.status).toBe(422);
  });

  it('refuses to link an office account', async () => {
    const { body } = await invite({ name: 'Dispecer', email: freshEmail(), role: 'dispatcher' });
    expect((await api().put(`/api/users/${body.user.id}/driver`).set(admin()).send({ driver_id: null }))
      .status).toBe(422);
  });
});

describe('resending an invitation', () => {
  it('issues a new link and invalidates the old one', async () => {
    const { body } = await invite({ name: 'Retrimis', email: freshEmail(), role: 'finance' });
    const first = new URL(body.invite_link).searchParams.get('token');

    const again = await api().post(`/api/users/${body.user.id}/resend-invite`).set(admin()).send({});
    expect(again.status).toBe(200);
    const second = new URL(again.body.invite_link).searchParams.get('token');
    expect(second).not.toBe(first);

    // Only one live invitation at a time.
    const old = await api().post('/api/auth/reset-password')
      .send({ resetToken: first, newPassword: 'parola-123' });
    expect(old.status).toBe(400);
  });

  it('refuses a deactivated account', async () => {
    const { body } = await invite({ name: 'Oprit', email: freshEmail(), role: 'finance' });
    await api().put(`/api/users/${body.user.id}/active`).set(admin()).send({ is_active: false });
    expect((await api().post(`/api/users/${body.user.id}/resend-invite`).set(admin()).send({}))
      .status).toBe(422);
  });
});

describe('everything leaves a trail', () => {
  it('records the invitation, the role change and the deactivation', async () => {
    const email = freshEmail();
    const { body } = await invite({ name: 'Urmărit', email, role: 'finance' });
    await api().put(`/api/users/${body.user.id}/role`).set(admin()).send({ role: 'dispatcher' });
    await api().put(`/api/users/${body.user.id}/active`).set(admin()).send({ is_active: false });

    const trail = await api().get(`/api/audit/trail/User/${body.user.id}`).set(admin());
    const actions = trail.body.events.map((e) => e.action);
    expect(actions).toContain('create');
    expect(actions.filter((a) => a === 'update')).toHaveLength(2);

    const roleChange = trail.body.events.find((e) => e.changes?.role);
    expect(roleChange.changes.role).toEqual({ from: 'finance', to: 'dispatcher' });
    expect(roleChange.label).toBe(email);
  });

  it('never writes the hash into the trail either', async () => {
    const rows = await query(
      `SELECT changes::text AS c FROM audit_events
       WHERE company_id = $1 AND entity = 'User' AND changes IS NOT NULL`,
      [ctx.company.id]
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    for (const row of rows.rows) expect(row.c).not.toMatch(/\$2[aby]\$/);
  });
});

describe('who may administer', () => {
  it('refuses a driver', async () => {
    expect((await api().get('/api/users').set(auth(ctx.driverToken))).status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await api().get('/api/users')).status).toBe(401);
  });
});

describe('tenancy', () => {
  it('never lists or touches another company’s people', async () => {
    const other = await seedCompany('users-other');
    try {
      const listed = await api().get('/api/users').set(admin());
      expect(listed.body.users.some((u) => u.email === other.admin.email)).toBe(false);

      const reach = await api().put(`/api/users/${other.admin.id}/role`)
        .set(admin()).send({ role: 'driver' });
      expect(reach.status).toBe(404);

      const off = await api().put(`/api/users/${other.admin.id}/active`)
        .set(admin()).send({ is_active: false });
      expect(off.status).toBe(404);
    } finally {
      await dropCompany(other.company.id);
    }
  });
});
