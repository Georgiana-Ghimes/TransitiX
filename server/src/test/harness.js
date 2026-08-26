/**
 * Harness for the route tests.
 *
 * These tests talk to a real Postgres, because that is where the bugs were. Every serious
 * defect this project has shipped lived at the seam the unit tests do not reach: a validator
 * that only accepted strings while pg returned `Date`, a SET clause that went out of step with
 * its value list, a SELECT naming a column that did not exist. None of those are reachable with
 * a mocked database, and all of them reached a running server.
 */
import request from 'supertest';
import { pool, query } from '../db.js';
import { signAccessToken } from '../middleware/auth.js';

/**
 * Refuses to touch anything that is not obviously a test database.
 *
 * This suite truncates and deletes. Pointed at a development database it would destroy real
 * work, so the name has to say out loud that it is disposable — there is no recovering from
 * getting this wrong once.
 */
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL || '';
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/_test$/.test(name)) {
    throw new Error(
      `Route tests refuse to run against "${name || '(unset)'}". `
      + 'Point DATABASE_URL at a database whose name ends in _test.'
    );
  }
  return name;
}

let counter = 0;

/**
 * A company of its own for each test file, with the users it needs.
 *
 * Everything in this system is scoped by `company_id`, so a private company is the cheapest
 * real isolation available — no shared fixtures to keep in sync, and one file's mess cannot
 * change another file's answer.
 */
export async function seedCompany(label = 'test') {
  counter += 1;
  const tag = `${label}-${Date.now()}-${counter}`;

  const company = (await query(
    `INSERT INTO companies (name, cui, address) VALUES ($1, $2, $3) RETURNING *`,
    [`Test ${tag}`, `RO${Date.now()}${counter}`, 'Str. Testelor 1']
  )).rows[0];

  const mkUser = async (role, suffix = '') => (await query(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, 'x', $4) RETURNING *`,
    [company.id, `${role}${suffix} ${tag}`, `${role}${suffix}-${tag}@test.local`, role]
  )).rows[0];

  const admin = await mkUser('admin');
  const driverUser = await mkUser('driver', 1);
  const otherDriverUser = await mkUser('driver', 2);

  const mkDriver = async (user, suffix) => (await query(
    `INSERT INTO drivers (company_id, user_id, name, phone, is_active)
     VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
    [company.id, user.id, `Sofer ${suffix} ${tag}`, `07000${counter}${suffix}`]
  )).rows[0];

  const driver = await mkDriver(driverUser, 1);
  const otherDriver = await mkDriver(otherDriverUser, 2);

  return {
    company,
    admin,
    driverUser,
    otherDriverUser,
    driver,
    otherDriver,
    // Tokens are minted, not logged in for: a test has no business handling a password, and the
    // login round-trip tests nothing these files are about.
    adminToken: signAccessToken(admin),
    driverToken: signAccessToken(driverUser),
    otherDriverToken: signAccessToken(otherDriverUser),
  };
}

/**
 * Deleting the company cascades to everything scoped under it.
 *
 * Retries on a deadlock: driver uploads start OCR in the background and deliberately do not wait
 * for it, so a teardown can land while that work is still writing. Failing the suite over a race
 * the product creates on purpose would only teach people to distrust the suite.
 */
export async function dropCompany(companyId, attempts = 5) {
  if (!companyId) return;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await query('DELETE FROM companies WHERE id = $1', [companyId]);
      return;
    } catch (err) {
      const contended = err?.code === '40P01' || err?.code === '55P03' || err?.code === '40001';
      if (!contended || attempt >= attempts) throw err;
      await new Promise((resolve) => { setTimeout(resolve, 100 * attempt); });
    }
  }
}

export async function closePool() {
  await pool.end();
}

/** `agent(app).get('/api/...').set(auth(token))` reads the way the route does. */
export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

export { request };

// ---------------------------------------------------------------- fixtures

/**
 * An override that is present wins, even when it is `null`.
 *
 * `overrides.x ?? fallback` cannot express "explicitly nothing", and a fixture that quietly
 * replaces a deliberate null with a default makes the missing-value tests pass for the wrong
 * reason — which is exactly the case this codebase keeps getting wrong.
 */
function pick(overrides, key, fallback) {
  return key in overrides ? overrides[key] : fallback;
}

export async function makeClient(companyId, name = 'Client Test') {
  return (await query(
    `INSERT INTO clients (company_id, name) VALUES ($1, $2) RETURNING *`,
    [companyId, name]
  )).rows[0];
}

export async function makeVehicle(companyId, overrides = {}) {
  return (await query(
    `INSERT INTO vehicles (company_id, plate, brand, model, vehicle_class, mma_kg, is_active)
     VALUES ($1, $2, 'Test', 'Camion', $3, $4, TRUE) RETURNING *`,
    [companyId, pick(overrides, 'plate', `B ${String(Date.now()).slice(-3)} TST`),
     pick(overrides, 'vehicle_class', '10t'), pick(overrides, 'mma_kg', 19000)]
  )).rows[0];
}

export async function makeTrip(companyId, overrides = {}) {
  return (await query(
    `INSERT INTO trips (company_id, cmr_number, shipper_name, shipper_address,
       consignee_name, consignee_address, loading_date, driver_id, vehicle_id, contract_id,
       goods_description, gross_weight_kg, package_count, status, tpo_number, tpo_total,
       tpo_calculated_at, distance_km)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11,$12,$13,
             COALESCE($14,'planificata'),$15,$16,$17,$18)
     RETURNING *`,
    [
      companyId,
      pick(overrides, 'cmr_number', `CMR-${Date.now()}-${(counter += 1)}`),
      pick(overrides, 'shipper_name', 'Baumit Romania SRL'),
      pick(overrides, 'shipper_address', 'Str. Fabricii 1, Chiajna'),
      pick(overrides, 'consignee_name', 'Depozit Chiajna SRL'),
      pick(overrides, 'consignee_address', 'Str. Depozitelor 5, Chiajna'),
      pick(overrides, 'loading_date', null),
      pick(overrides, 'driver_id', null),
      pick(overrides, 'vehicle_id', null),
      pick(overrides, 'contract_id', null),
      pick(overrides, 'goods_description', 'Mortar uscat'),
      pick(overrides, 'gross_weight_kg', 9000),
      pick(overrides, 'package_count', 18),
      pick(overrides, 'status', null),
      pick(overrides, 'tpo_number', null),
      pick(overrides, 'tpo_total', null),
      pick(overrides, 'tpo_calculated_at', null),
      pick(overrides, 'distance_km', null),
    ]
  )).rows[0];
}

export async function makeAviz(companyId, overrides = {}) {
  return (await query(
    `INSERT INTO aviz_documents (company_id, file_url, original_filename, status, numar_tpo,
       numar_auto, ruta_transport, tip_marfa, cantitate_marfa, numar_document_marfa,
       gross_weight_kg, net_weight_kg, pallets, quantity_unit, data_efectuare_cursa,
       km_parcursi, tarif_km, valoare_tpo, needs_review, trip_id, batch_id)
     VALUES ($1,'/uploads/test.pdf',$2,COALESCE($3,'confirmed'),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             COALESCE($14, CURRENT_DATE),$15,$16,$17,COALESCE($18,FALSE),$19,$20)
     RETURNING *`,
    [
      companyId,
      pick(overrides, 'original_filename', `aviz-${(counter += 1)}.pdf`),
      pick(overrides, 'status', null),
      pick(overrides, 'numar_tpo', `TPO ${Date.now()}-${counter}`),
      pick(overrides, 'numar_auto', 'B 123 ABC'),
      pick(overrides, 'ruta_transport', 'Bucuresti - Chiajna'),
      pick(overrides, 'tip_marfa', 'Mortar uscat'),
      pick(overrides, 'cantitate_marfa', 378),
      pick(overrides, 'numar_document_marfa', 'PSL 4417/2026'),
      pick(overrides, 'gross_weight_kg', 9000),
      pick(overrides, 'net_weight_kg', 8244),
      pick(overrides, 'pallets', 18),
      pick(overrides, 'quantity_unit', 'saci'),
      pick(overrides, 'data_efectuare_cursa', null),
      pick(overrides, 'km_parcursi', 42),
      pick(overrides, 'tarif_km', 2.5),
      pick(overrides, 'valoare_tpo', 250),
      pick(overrides, 'needs_review', null),
      pick(overrides, 'trip_id', null),
      pick(overrides, 'batch_id', null),
    ]
  )).rows[0];
}

export async function makeContractWithTariff(companyId, clientId, tariff = {}) {
  const contract = (await query(
    `INSERT INTO contracts (company_id, client_id, code, name, starts_on)
     VALUES ($1,$2,$3,$3,'2020-01-01') RETURNING *`,
    [companyId, clientId, `CTR-${Date.now()}-${(counter += 1)}`]
  )).rows[0];
  if (tariff !== null) {
    await query(
      `INSERT INTO contract_tariffs (company_id, contract_id, vehicle_class, trip_rate, km_rate, valid_from)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [companyId, contract.id, pick(tariff, 'vehicle_class', '10t'),
       pick(tariff, 'trip_rate', 250), pick(tariff, 'km_rate', 2.5),
       pick(tariff, 'valid_from', '2020-01-01')]
    );
  }
  return contract;
}

export async function makeTemplate(companyId, name, columns) {
  return (await query(
    `INSERT INTO report_templates (company_id, name, columns, is_default)
     VALUES ($1,$2,$3::jsonb,FALSE) RETURNING *`,
    [companyId, name, JSON.stringify(columns)]
  )).rows[0];
}
