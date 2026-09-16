import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Google itself is never called from a test; the verifier is replaced with one that trusts the
// "credential" string as the identity, so the route's own decisions are what gets exercised.
vi.mock('../lib/auth/google.js', () => ({
  googleClientId: () => 'test-client',
  verifyGoogleIdToken: async (credential) => {
    if (credential === 'invalid') {
      const err = new Error('Răspunsul Google nu este valid.');
      err.status = 401;
      throw err;
    }
    const [sub, email, name] = String(credential).split('|');
    return { sub, email: email.toLowerCase(), name: name || null, hosted_domain: null };
  },
}));

const { default: app } = await import('../app.js');
const { query } = await import('../db.js');
const { auth, closePool, dropCompany, request, seedCompany } = await import('../test/harness.js');

const PASSWORD = 'o parola lunga de test';
const run = `${Date.now()}`;
let seq = 0;
const companies = new Set();
let ctx;

const api = () => request(app);
const domain = () => `firma-${run}-${(seq += 1)}.test`;
const personalEmail = () => `persoana.${run}.${(seq += 1)}@gmail.com`;

async function track(email) {
  const row = (await query('SELECT company_id FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0];
  if (row) companies.add(row.company_id);
  return row;
}

async function register(body) {
  const res = await api().post('/api/auth/register').send({
    name: 'Ana Pop',
    company_name: 'Firma Test SRL',
    password: PASSWORD,
    account_type: 'institution',
    ...body,
  });
  if (body.email) await track(body.email);
  return res;
}

const tokenFrom = (link) => new URL(link).searchParams.get('token');

beforeAll(async () => {
  ctx = await seedCompany('signup');
});

afterAll(async () => {
  for (const id of companies) await dropCompany(id);
  await dropCompany(ctx?.company?.id);
  await closePool();
});

describe('what the screens may offer', () => {
  it('reports sign-up, Google and the password minimum', async () => {
    const res = await api().get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ signup_enabled: true, google_client_id: 'test-client', password_min_length: 10 });
  });
});

describe('checking an address before submitting', () => {
  it('tells a personal address from a company one', async () => {
    const res = await api().post('/api/auth/check-email').send({ email: personalEmail() });
    expect(res.body).toMatchObject({ valid: true, personal: true, email_taken: false, domain_in_use: false });
  });

  it('says when colleagues on the same domain already have accounts', async () => {
    const d = domain();
    await register({ email: `sef@${d}` });
    const res = await api().post('/api/auth/check-email').send({ email: `coleg@${d}` });
    expect(res.body).toMatchObject({ personal: false, domain_in_use: true, email_taken: false });
  });

  it('refuses something that is not an address', async () => {
    expect((await api().post('/api/auth/check-email').send({ email: 'x' })).body.valid).toBe(false);
  });
});

describe('registering with a company address', () => {
  it('creates the company, makes the person admin, and waits for the link', async () => {
    const email = `ana@${domain()}`;
    const res = await register({ email });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ verification_required: true, email, email_sent: false });
    // No mail provider in tests: the link comes back rather than vanishing into a log.
    expect(res.body.verify_link).toContain('/verify-email?token=');
    expect(res.body.access_token).toBeUndefined();

    const row = (await query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    expect(row).toMatchObject({ role: 'admin', created_via: 'signup', email_verified_at: null });
    // Only the hash is stored.
    expect(row.email_verify_token_hash).not.toBe(tokenFrom(res.body.verify_link));
  });

  it('refuses to sign in until the address is confirmed, then signs in', async () => {
    const email = `ion@${domain()}`;
    const { body } = await register({ email });

    const early = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');

    const verified = await api().post('/api/auth/verify-email').send({ token: tokenFrom(body.verify_link) });
    expect(verified.status).toBe(200);
    expect(verified.body.access_token).toBeTruthy();
    expect(verified.body.user.email_verified).toBe(true);

    const login = await api().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('uses a link once', async () => {
    const { body } = await register({ email: `o-data@${domain()}` });
    const token = tokenFrom(body.verify_link);
    expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(200);
    const again = await api().post('/api/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('VERIFY_LINK_INVALID');
  });

  it('refuses an expired link', async () => {
    const email = `expirat@${domain()}`;
    const { body } = await register({ email });
    await query(`UPDATE users SET email_verify_expires_at = NOW() - INTERVAL '1 minute' WHERE email = $1`, [email]);
    expect((await api().post('/api/auth/verify-email').send({ token: tokenFrom(body.verify_link) })).status).toBe(400);
  });

  it('issues a new link and retires the old one', async () => {
    const email = `retrimis@${domain()}`;
    const first = (await register({ email })).body.verify_link;
    const resent = await api().post('/api/auth/resend-verification').send({ email });
    expect(resent.status).toBe(200);
    expect(resent.body.verify_link).toBeTruthy();
    expect((await api().post('/api/auth/verify-email').send({ token: tokenFrom(first) })).status).toBe(400);
    expect((await api().post('/api/auth/verify-email').send({ token: tokenFrom(resent.body.verify_link) })).status).toBe(200);
  });

  it('answers a resend for an unknown address the same way, with no link', async () => {
    const res = await api().post('/api/auth/resend-verification').send({ email: `nimeni@${domain()}` });
    expect(res.status).toBe(200);
    expect(res.body.verify_link).toBeUndefined();
  });

  it('asks before creating a second company on a domain already in use', async () => {
    const d = domain();
    await register({ email: `primul@${d}` });

    const second = await register({ email: `al-doilea@${d}` });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'DOMAIN_IN_USE', domain: d });

    const confirmed = await register({ email: `al-doilea@${d}`, confirm_domain: true });
    expect(confirmed.status).toBe(201);
  });

  it('refuses a personal address declared as a company one', async () => {
    const res = await register({ email: personalEmail(), account_type: 'institution' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIGNUP');
  });

  it('refuses a short password, and every missing field at once', async () => {
    const res = await api().post('/api/auth/register').send({ email: `x@${domain()}`, password: 'scurt' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses an address that already has an account, in any company', async () => {
    const res = await register({ email: ctx.admin.email.toUpperCase(), confirm_domain: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });
});

describe('registering with a personal address', () => {
  it('never warns about the domain, gmail says nothing about the employer', async () => {
    const first = await register({ email: personalEmail(), account_type: 'personal' });
    const second = await register({ email: personalEmail(), account_type: 'personal' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

describe('when sign-up is switched off', () => {
  it('refuses registration and says whom to ask', async () => {
    process.env.ALLOW_SIGNUP = 'false';
    try {
      const res = await register({ email: `oprit@${domain()}` });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SIGNUP_DISABLED');
      expect((await api().get('/api/auth/providers')).body.signup_enabled).toBe(false);
    } finally {
      delete process.env.ALLOW_SIGNUP;
    }
  });
});

describe('Google', () => {
  const google = (body) => api().post('/api/auth/google').send(body);

  it('asks for a company name the first time an address is seen', async () => {
    const email = personalEmail();
    const res = await google({ credential: `g-${seq}|${email}|Ana Google` });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'GOOGLE_NEEDS_COMPANY', email, name: 'Ana Google', personal: true });
  });

  it('creates a verified admin once it has one, and signs in again later', async () => {
    const email = personalEmail();
    const credential = `g-new-${seq}|${email}|Ion Google`;
    const created = await google({ credential, company_name: 'Google SRL' });
    await track(email);
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ role: 'admin', email_verified: true });

    const again = await google({ credential });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(created.body.user.id);
  });

  it('signs an existing account in and claims a pending invitation', async () => {
    const email = `invitat-google-${run}@test.local`;
    const invite = await api().post('/api/users/invite').set(auth(ctx.adminToken))
      .send({ name: 'Invitat Google', email, role: 'dispatcher' });
    expect(invite.status).toBe(201);

    const res = await google({ credential: `g-inv-${run}|${email}` });
    expect(res.status).toBe(200);
    expect(res.body.user.company_id).toBe(ctx.company.id);

    // The invitation link is spent: Google proved the mailbox already.
    const link = await api().post('/api/auth/reset-password')
      .send({ resetToken: tokenFrom(invite.body.invite_link), newPassword: PASSWORD });
    expect(link.status).toBe(400);
  });

  it('refuses the same address from a different Google account', async () => {
    const email = personalEmail();
    await google({ credential: `g-a-${run}|${email}`, company_name: 'Prima SRL' });
    await track(email);
    const other = await google({ credential: `g-b-${run}|${email}` });
    expect(other.status).toBe(401);
  });

  it('refuses a deactivated account', async () => {
    const email = `dezactivat-google-${run}@test.local`;
    await query(
      `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
       VALUES ($1, 'Plecat', $2, 'x', 'dispatcher', FALSE)`,
      [ctx.company.id, email]
    );
    expect((await google({ credential: `g-off-${run}|${email}` })).status).toBe(403);
  });

  it('passes on a token the verifier rejects', async () => {
    expect((await google({ credential: 'invalid' })).status).toBe(401);
  });
});

describe('an account added by hand', () => {
  const manual = (body) => api().post('/api/users/manual').set(auth(ctx.adminToken)).send(body);

  it('returns a generated temporary password once, and never stores it in the trail', async () => {
    const email = `manual-${run}-${(seq += 1)}@test.local`;
    const res = await manual({ name: 'Manual Unu', email, role: 'dispatcher' });
    expect(res.status).toBe(201);
    expect(res.body.temporary_password).toMatch(/^.{12}$/);
    expect(res.body.user).toMatchObject({ state: 'manual', must_change_password: true, created_via: 'manual' });

    const trail = await query(
      `SELECT changes::text AS c FROM audit_events WHERE company_id = $1 AND entity = 'User' AND label = $2`,
      [ctx.company.id, email]
    );
    expect(trail.rows[0].c).not.toContain(res.body.temporary_password);
  });

  it('does not echo a password the admin typed', async () => {
    const res = await manual({
      name: 'Manual Doi', email: `manual-${run}-${(seq += 1)}@test.local`, role: 'finance',
      temporary_password: 'temporara-2026',
    });
    expect(res.status).toBe(201);
    expect(res.body.temporary_password).toBeUndefined();
  });

  it('refuses a temporary password under the policy', async () => {
    const res = await manual({ name: 'Scurt', email: `manual-${run}-${(seq += 1)}@test.local`, role: 'finance', temporary_password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Parola temporară/);
  });

  it('refuses an address used in another company', async () => {
    const email = personalEmail();
    await register({ email, account_type: 'personal' });
    const res = await manual({ name: 'Dublura', email, role: 'finance' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/altă firmă/);
  });

  it('keeps the person out of the app until they choose their own password', async () => {
    const email = `manual-${run}-${(seq += 1)}@test.local`;
    const { body } = await manual({ name: 'Manual Trei', email, role: 'dispatcher' });
    const temp = body.temporary_password;

    const login = await api().post('/api/auth/login').send({ email, password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.must_change_password).toBe(true);
    const token = login.body.access_token;

    const blocked = await api().get('/api/avize').set(auth(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(200);

    const wrong = await api().post('/api/auth/change-password').set(auth(token))
      .send({ current_password: 'nu-e-asta', new_password: PASSWORD });
    expect(wrong.status).toBe(400);
    const same = await api().post('/api/auth/change-password').set(auth(token))
      .send({ current_password: temp, new_password: temp });
    expect(same.status).toBe(400);

    const changed = await api().post('/api/auth/change-password').set(auth(token))
      .send({ current_password: temp, new_password: PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.user.must_change_password).toBe(false);

    // The session the admin could have opened with the temporary password is gone.
    const oldRefresh = await api().post('/api/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(oldRefresh.status).toBe(401);

    expect((await api().get('/api/avize').set(auth(changed.body.access_token))).status).not.toBe(403);
    expect((await api().post('/api/auth/login').send({ email, password: temp })).status).toBe(401);
  });

  it('is admin only', async () => {
    const res = await api().post('/api/users/manual').set(auth(ctx.driverToken))
      .send({ name: 'X', email: `manual-${run}-x@test.local`, role: 'admin' });
    expect(res.status).toBe(403);
  });
});

describe('the invitation checks every company too', () => {
  it('refuses an address that belongs to another company', async () => {
    const email = personalEmail();
    await register({ email, account_type: 'personal' });
    const res = await api().post('/api/users/invite').set(auth(ctx.adminToken))
      .send({ name: 'Altundeva', email, role: 'finance' });
    expect(res.status).toBe(409);
  });
});
