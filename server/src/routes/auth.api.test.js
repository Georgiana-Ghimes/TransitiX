import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import { query } from '../db.js';
import { closePool, dropCompany, request, seedCompany } from '../test/harness.js';

const PASSWORD = 'parola-de-test-123';

let ctx;
let email;

beforeAll(async () => {
  ctx = await seedCompany('auth');
  email = `sesiuni-${Date.now()}@test.local`;
  await query(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, 'Sesiuni', $2, $3, 'admin')`,
    [ctx.company.id, email, bcrypt.hashSync(PASSWORD, 10)]
  );
});

afterAll(async () => {
  await dropCompany(ctx?.company?.id);
  await closePool();
});

const api = () => request(app);
const login = () => api().post('/api/auth/login').send({ email, password: PASSWORD });

describe('login', () => {
  it('returns a pair and records the session', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();

    const rows = await query(
      'SELECT * FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = $1)',
      [email]
    );
    expect(rows.rowCount).toBeGreaterThan(0);
  });

  it('rejects a wrong password', async () => {
    const res = await api().post('/api/auth/login').send({ email, password: 'gresit' });
    expect(res.status).toBe(401);
  });
});

describe('logout actually ends the session', () => {
  it('stops the refresh token from working again', async () => {
    // This is the whole point: before sessions were tracked, logout was `{ ok: true }` and the
    // token kept working for a week — a lost phone stayed signed in.
    const { body } = await login();

    const out = await api().post('/api/auth/logout').send({ refresh_token: body.refresh_token });
    expect(out.status).toBe(200);

    const refreshed = await api().post('/api/auth/refresh')
      .send({ refresh_token: body.refresh_token });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.message).toContain('revocat');
  });

  it('leaves other sessions alone', async () => {
    const phone = (await login()).body;
    const laptop = (await login()).body;

    await api().post('/api/auth/logout').send({ refresh_token: phone.refresh_token });

    const still = await api().post('/api/auth/refresh')
      .send({ refresh_token: laptop.refresh_token });
    expect(still.status).toBe(200);
  });

  it('answers ok even with nothing to revoke', async () => {
    // The caller wants "this session no longer works", which is already true.
    expect((await api().post('/api/auth/logout').send({})).status).toBe(200);
    expect((await api().post('/api/auth/logout').send({ refresh_token: 'gunoi' })).status).toBe(200);
  });
});

describe('refresh rotates the session', () => {
  it('hands back a new pair and retires the old token', async () => {
    // A refresh token that leaks is then usable at most once, because the real client's next
    // refresh invalidates it.
    const first = (await login()).body;

    const second = await api().post('/api/auth/refresh')
      .send({ refresh_token: first.refresh_token });
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);

    const replay = await api().post('/api/auth/refresh')
      .send({ refresh_token: first.refresh_token });
    expect(replay.status).toBe(401);
  });

  it('refuses a token signed for nothing', async () => {
    const res = await api().post('/api/auth/refresh').send({ refresh_token: 'nu-e-token' });
    expect(res.status).toBe(401);
  });

  it('refuses an access token used as a refresh token', async () => {
    const { body } = await login();
    const res = await api().post('/api/auth/refresh').send({ refresh_token: body.access_token });
    expect(res.status).toBe(401);
  });

  it('refuses a session revoked while the token was still valid', async () => {
    const { body } = await login();
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = (SELECT id FROM users WHERE email = $1) AND revoked_at IS NULL`,
      [email]
    );
    const res = await api().post('/api/auth/refresh').send({ refresh_token: body.refresh_token });
    expect(res.status).toBe(401);
  });
});

describe('session list and sign out everywhere', () => {
  it('lists the sessions signed in right now', async () => {
    const a = (await login()).body;
    await login();

    const res = await api().get('/api/auth/sessions')
      .set({ Authorization: `Bearer ${a.access_token}` });
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('cuts off every device at once — what a lost phone needs', async () => {
    const phone = (await login()).body;
    const laptop = (await login()).body;

    const res = await api().post('/api/auth/sessions/revoke-all')
      .set({ Authorization: `Bearer ${laptop.access_token}` });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(2);

    for (const token of [phone.refresh_token, laptop.refresh_token]) {
      expect((await api().post('/api/auth/refresh').send({ refresh_token: token })).status).toBe(401);
    }
  });

  it('needs authentication to list or revoke', async () => {
    expect((await api().get('/api/auth/sessions')).status).toBe(401);
    expect((await api().post('/api/auth/sessions/revoke-all')).status).toBe(401);
  });
});
